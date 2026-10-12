// Regresión B09 (segunda auditoría): reiniciar el servidor no deja a nadie
// afuera de la partida, y A04 sigue cerrado (sin secreto no hay identidad).
// Servidores locales efímeros con ROOM_SECRET fijo; nunca producción.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 9100 + Math.floor(Math.random() * 90);
const SECRET = 'prueba-de-reinicio-con-secreto-estable';
let proc;

async function boot(env = { ROOM_SECRET: SECRET }) {
  proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r, j) => {
    proc.stdout.on('data', (d) => d.toString().includes('escuchando') && r());
    proc.once('exit', (c) => j(new Error(`el servidor terminó (código ${c})`)));
  });
}
async function stop() {
  if (!proc) return;
  await new Promise((r) => { proc.once('exit', r); proc.kill(); });
  proc = undefined;
}
after(stop);

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const queue = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const w = waiters.shift();
      if (w) w(m); else queue.push(m);
    });
    ws.on('error', () => {});
    ws.on('open', () => resolve({
      ws,
      send: (o) => ws.send(JSON.stringify(o)),
      next: (ms = 1000) => new Promise((r) => {
        const m = queue.shift();
        if (m) return r(m);
        const fn = (x) => { clearTimeout(t); r(x); };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(fn), 1); r(null); }, ms);
        waiters.push(fn);
      })
    }));
    ws.on('error', reject);
  });
}

/** Juez + jugador + pantalla, y sus credenciales. */
async function setup() {
  const host = await connect();
  host.send({ t: 'host' });
  const hosted = await host.next();
  const player = await connect();
  player.send({ t: 'join', room: hosted.room, role: 'player', name: 'Ana' });
  const joined = await player.next();
  const screen = await connect();
  screen.send({ t: 'join', room: hosted.room, role: 'screen', name: 'TV' });
  const sjoined = await screen.next();
  for (const c of [host, player, screen]) c.ws.close();
  return { hosted, joined, sjoined };
}

test('B09: tras reiniciar, el juez recupera el mismo código y el celular su puesto', async (t) => {
  t.after(stop);
  await boot();
  const { hosted, joined } = await setup();
  await stop();
  await boot();

  const host = await connect();
  host.send({ t: 'host', room: hosted.room, key: hosted.key });
  const re = await host.next();
  assert.equal(re.t, 'hosted');
  assert.equal(re.room, hosted.room, 'mismo código de sala');
  assert.equal(re.key, hosted.key);

  const ana = await connect();
  ana.send({ t: 'join', room: hosted.room, role: 'player', name: 'Ana', pid: joined.pid, secret: joined.secret });
  const j2 = await ana.next();
  assert.equal(j2.t, 'joined');
  assert.equal(j2.pid, joined.pid, 'misma identidad');
  assert.equal(j2.hostOnline, true);
  const peer = await host.next();
  assert.equal(peer.pid, joined.pid);
  ana.send({ t: 'msg', data: { k: 'buzz', at: 1 } });
  assert.equal((await host.next()).from, joined.pid);
  host.ws.close(); ana.ws.close();
  await stop();
});

test('B09: el celular que vuelve antes que el juez espera en la misma sala', async (t) => {
  t.after(stop);
  await boot();
  const { hosted, joined } = await setup();
  await stop();
  await boot();

  const ana = await connect();
  ana.send({ t: 'join', room: hosted.room, role: 'player', name: 'Ana', pid: joined.pid, secret: joined.secret });
  const j = await ana.next();
  assert.equal(j.t, 'joined');
  assert.equal(j.pid, joined.pid);
  assert.equal(j.hostOnline, false, 'todavía sin juez');

  const host = await connect();
  host.send({ t: 'host', room: hosted.room, key: hosted.key });
  const re = await host.next();
  assert.equal(re.room, hosted.room);
  assert.deepEqual(re.peers.map((p) => p.pid), [joined.pid], 'el juez ve al celular que ya volvió');
  assert.equal((await ana.next()).t, 'host_back');
  host.ws.close(); ana.ws.close();
  await stop();
});

test('B09/A04: tras reiniciar, credenciales falsas no recuperan nada', async (t) => {
  t.after(stop);
  await boot();
  const { hosted, joined } = await setup();
  await stop();
  await boot();

  // Secreto inventado para un pid real: no se acepta la identidad ni se crea la sala.
  const intruso = await connect();
  intruso.send({ t: 'join', room: hosted.room, role: 'player', name: 'X', pid: joined.pid, secret: 'a'.repeat(32) });
  assert.equal((await intruso.next()).code, 'no_room');
  // El secreto de un jugador no sirve para la pantalla ni para otro pid.
  const otro = await connect();
  otro.send({ t: 'join', room: hosted.room, role: 'screen', name: 'X', pid: joined.pid, secret: joined.secret });
  assert.equal((await otro.next()).code, 'no_room');
  // Una clave de juez inventada para ese código tampoco.
  const falso = await connect();
  falso.send({ t: 'host', room: hosted.room, key: 'b'.repeat(48) });
  const r = await falso.next();
  assert.equal(r.t, 'error');
  assert.equal(r.code, 'bad_key');

  // El juez real sigue pudiendo volver con su código.
  const host = await connect();
  host.send({ t: 'host', room: hosted.room, key: hosted.key });
  assert.equal((await host.next()).room, hosted.room);
  for (const c of [intruso, otro, falso, host]) c.ws.close();
  await stop();
});

test('B09: sin ROOM_SECRET estable, el reinicio da sala nueva (camino de aprobación del juez)', async (t) => {
  t.after(stop);
  await boot({ ROOM_SECRET: '' });
  const { hosted, joined } = await setup();
  await stop();
  await boot({ ROOM_SECRET: '' });
  const host = await connect();
  host.send({ t: 'host', room: hosted.room, key: hosted.key });
  const r = await host.next();
  assert.equal(r.code, 'bad_key', 'la clave anterior no se puede verificar');
  const ana = await connect();
  ana.send({ t: 'join', room: hosted.room, role: 'player', name: 'Ana', pid: joined.pid, secret: joined.secret });
  assert.equal((await ana.next()).code, 'no_room');
  host.ws.close(); ana.ws.close();
  await stop();
});

test('una clave vieja no toma una sala viva con el mismo código', async (t) => {
  t.after(stop);
  await boot();
  const host = await connect();
  host.send({ t: 'host' });
  const hosted = await host.next();
  // Clave firmada válida para ese código pero de otra "vida" de la sala:
  // el servidor vivo exige la clave exacta de la sala actual.
  const otro = await connect();
  otro.send({ t: 'host', room: hosted.room, key: hosted.key.slice(0, 16).replace(/./, (c) => (c === 'a' ? 'b' : 'a')) + hosted.key.slice(16) });
  assert.equal((await otro.next()).code, 'bad_key');
  host.ws.close(); otro.ws.close();
  await stop();
});
