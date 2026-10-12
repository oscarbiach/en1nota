// Regresiones de la auditoría (A03, A04, A05): validación de mensajes,
// identidad de reconexión y revocación de conexiones reemplazadas.
// Corre contra un servidor local efímero; nunca contra producción.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 8900 + Math.floor(Math.random() * 90);
let proc;

before(async () => {
  proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => proc.stdout.on('data', (d) => d.toString().includes('escuchando') && r()));
});
after(() => proc?.kill());

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const queue = [];
    const waiters = [];
    let closed = null;
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const w = waiters.shift();
      if (w) w(m); else queue.push(m);
    });
    ws.on('close', (code) => { closed = code; });
    ws.on('open', () => resolve({
      ws,
      send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
      /** Próximo mensaje, o null si no llega nada en `ms`. */
      next: (ms = 1000) => new Promise((r) => {
        const m = queue.shift();
        if (m) return r(m);
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(fn), 1); r(null); }, ms);
        const fn = (x) => { clearTimeout(t); r(x); };
        waiters.push(fn);
      }),
      closedCode: () => closed
    }));
    ws.on('error', reject);
  });
}

async function hostRoom() {
  const host = await connect();
  host.send({ t: 'host' });
  const hosted = await host.next();
  assert.equal(hosted.t, 'hosted');
  return { host, hosted };
}

async function joinPlayer(room, extra = {}) {
  const p = await connect();
  p.send({ t: 'join', room, role: 'player', name: 'Ana', ...extra });
  const joined = await p.next();
  return { p, joined };
}

test('A03: datos malformados del jugador no llegan al juez', async () => {
  const { host, hosted } = await hostRoom();
  const { p, joined } = await joinPlayer(hosted.room);
  assert.equal(joined.t, 'joined');
  assert.equal((await host.next()).t, 'peer');

  const bad = [
    { t: 'msg', data: null },
    { t: 'msg', data: 'hola' },
    { t: 'msg', data: { k: 'hello', role: 'player', name: { trim: 1 } } },
    { t: 'msg', data: { k: 'hello', role: 'admin', name: 'x' } },
    { t: 'msg', data: { k: 'hello', role: 'screen', name: 'x' } }, // un jugador no puede declararse pantalla
    { t: 'msg', data: { k: 'buzz' } },
    { t: 'msg', data: { k: 'buzz', at: 'ya' } },
    { t: 'msg', data: { k: 'rename', name: 42 } },
    { t: 'msg', data: { k: 'state', state: {} } }, // mensaje de juez desde un jugador
    'esto no es json',
    { t: 42 }
  ];
  for (const b of bad) p.send(b);
  // Un mensaje válido detrás de los inválidos: es lo único que debe llegar.
  p.send({ t: 'msg', data: { k: 'buzz', at: 123, localAt: 456, extra: 'se descarta' } });
  const got = await host.next();
  assert.equal(got.t, 'msg');
  assert.deepEqual(got.data, { k: 'buzz', at: 123, localAt: 456 });
  assert.equal(await host.next(300), null, 'no debería llegar nada más');

  // Los nombres largos válidos se recortan, no se rechazan.
  p.send({ t: 'msg', data: { k: 'hello', role: 'player', name: 'Nombre larguísimo que excede el límite' } });
  const hello = await host.next();
  assert.equal(hello.data.name.length, 24);

  // El servidor sigue vivo y responde.
  host.send({ t: 'ping', c: 1 });
  assert.equal((await host.next()).t, 'pong');
  for (const c of [host, p]) c.ws.close();
});

test('A03: un mensaje que excede el tamaño máximo cierra sólo esa conexión', async () => {
  const { host, hosted } = await hostRoom();
  const { p } = await joinPlayer(hosted.room);
  await host.next();
  p.send({ t: 'msg', data: { k: 'hello', role: 'player', name: 'x'.repeat(70_000) } });
  assert.equal((await host.next()).connected, false, 'el juez ve al jugador desconectado');
  assert.equal(await host.next(300), null, 'el contenido nunca llega');
  host.send({ t: 'ping', c: 7 });
  assert.equal((await host.next()).c, 7, 'el juez sigue conectado');
  host.ws.close();
});

test('A03: join y host con campos de tipo incorrecto no rompen el servidor', async () => {
  const c = await connect();
  c.send({ t: 'join', room: { x: 1 }, role: 'player', name: 'x' });
  assert.equal((await c.next()).code, 'no_room');
  c.send({ t: 'host', room: ['AB'], key: { a: 1 } });
  const hosted = await c.next();
  assert.equal(hosted.t, 'hosted');
  const d = await connect();
  d.send({ t: 'join', room: hosted.room, role: 'player', name: { a: 1 }, pid: { a: 1 } });
  const joined = await d.next();
  assert.equal(joined.t, 'joined');
  const peer = await c.next();
  assert.equal(peer.name, '');
  c.ws.close(); d.ws.close();
});

test('A04: conocer sala y pid no alcanza para tomar la identidad de otro jugador', async () => {
  const { host, hosted } = await hostRoom();
  const { p: ana, joined } = await joinPlayer(hosted.room);
  assert.equal(typeof joined.secret, 'string');
  assert.ok(joined.secret.length >= 16);
  await host.next(); // peer Ana

  // El roster que recibe el juez no expone el secreto.
  host.ws.close();
  const host2 = await connect();
  host2.send({ t: 'host', room: hosted.room, key: hosted.key });
  const re = await host2.next();
  assert.ok(re.peers.every((x) => !('secret' in x)));

  // Intruso con el pid público pero sin secreto: recibe otra identidad.
  const { p: intruso, joined: j2 } = await joinPlayer(hosted.room, { pid: joined.pid });
  assert.equal(j2.t, 'joined');
  assert.notEqual(j2.pid, joined.pid);
  // Con un secreto falso tampoco.
  const { p: intruso2, joined: j3 } = await joinPlayer(hosted.room, { pid: joined.pid, secret: 'x'.repeat(32) });
  assert.notEqual(j3.pid, joined.pid);

  // Ana no fue desplazada: sus pulsaciones siguen llegando con su pid.
  for (;;) { const m = await host2.next(300); if (!m) break; }
  const anaGot = [];
  for (;;) { const m = await ana.next(200); if (!m) break; anaGot.push(m.t); }
  assert.ok(!anaGot.includes('replaced'), `Ana no debería recibir replaced (recibió ${anaGot})`);
  ana.send({ t: 'msg', data: { k: 'buzz', at: 1, localAt: 1 } });
  const buzz = await host2.next();
  assert.equal(buzz.from, joined.pid);

  // La recarga legítima con secreto conserva el pid.
  ana.ws.close();
  await host2.next(); // peer desconectado
  const { p: ana2, joined: j4 } = await joinPlayer(hosted.room, { pid: joined.pid, secret: joined.secret });
  assert.equal(j4.pid, joined.pid);
  assert.equal(j4.secret, joined.secret);
  for (const c of [host2, intruso, intruso2, ana2]) c.ws.close();
});

test('A05: una conexión de juez reemplazada pierde toda autoridad', async () => {
  const { host: viejo, hosted } = await hostRoom();
  const { p, joined } = await joinPlayer(hosted.room);
  await viejo.next(); // peer

  const nuevo = await connect();
  nuevo.send({ t: 'host', room: hosted.room, key: hosted.key });
  assert.equal((await nuevo.next()).t, 'hosted');
  assert.equal((await viejo.next()).t, 'host_replaced');
  assert.equal((await p.next()).t, 'host_back');

  // Aunque el cliente viejo ignorara el aviso, el servidor no le hace caso.
  viejo.send({ t: 'msg', to: 'all', data: { k: 'state', state: { phase: 'falso' } } });
  viejo.send({ t: 'kick', pid: joined.pid });
  viejo.send({ t: 'close_room' });
  assert.equal(await p.next(400), null, 'el jugador no debe recibir nada del juez viejo');

  // La sala sigue viva para el juez nuevo.
  nuevo.send({ t: 'msg', to: 'all', data: { k: 'state', state: { phase: 'ready' } } });
  assert.equal((await p.next()).data.state.phase, 'ready');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(viejo.closedCode() !== null, 'el servidor cierra la conexión vieja');
  for (const c of [nuevo, p]) c.ws.close();
});

test('A05: una conexión de jugador reemplazada no puede pulsar', async () => {
  const { host, hosted } = await hostRoom();
  const { p: viejo, joined } = await joinPlayer(hosted.room);
  await host.next();
  const { p: nuevo, joined: j2 } = await joinPlayer(hosted.room, { pid: joined.pid, secret: joined.secret });
  assert.equal(j2.pid, joined.pid);
  assert.equal((await viejo.next()).t, 'replaced');
  await host.next(); // peer conectado de nuevo

  viejo.send({ t: 'msg', data: { k: 'buzz', at: 1, localAt: 1 } });
  assert.equal(await host.next(400), null, 'la pulsación del socket viejo no se reenvía');
  nuevo.send({ t: 'msg', data: { k: 'buzz', at: 2, localAt: 2 } });
  assert.equal((await host.next()).data.at, 2);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(viejo.closedCode() !== null, 'el servidor cierra la conexión vieja');
  for (const c of [host, nuevo]) c.ws.close();
});

test('A05: una conexión no puede cambiar de rol ni de sala', async () => {
  const { host, hosted } = await hostRoom();
  const { p } = await joinPlayer(hosted.room);
  await host.next();
  // El jugador intenta convertirse en juez de una sala nueva.
  p.send({ t: 'host' });
  const r = await p.next();
  assert.equal(r?.t, 'error');
  host.ws.close(); p.ws.close();
});

test('A05/B09: un jugador expulsado que vuelve con su secreto entra como alguien nuevo', async () => {
  const { host, hosted } = await hostRoom();
  const { p, joined } = await joinPlayer(hosted.room);
  await host.next();
  host.send({ t: 'kick', pid: joined.pid });
  assert.equal((await p.next()).t, 'kicked');
  const { p: again, joined: j2 } = await joinPlayer(hosted.room, { pid: joined.pid, secret: joined.secret });
  assert.equal(j2.t, 'joined');
  assert.notEqual(j2.pid, joined.pid);
  host.ws.close(); again.ws.close();
});
