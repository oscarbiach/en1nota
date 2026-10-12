// Riesgo de recursos (segunda auditoría): límites de salas, conexiones,
// identidades por sala y frecuencia de mensajes; limpieza y métricas.
// Servidores locales con límites chicos por variables de entorno; sin carga real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

let nextPort = 9200 + Math.floor(Math.random() * 50) * 10;

async function boot(env) {
  const port = nextPort++;
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((r, j) => {
    proc.stdout.on('data', (d) => d.toString().includes('escuchando') && r());
    proc.once('exit', (c) => j(new Error(`el servidor terminó (código ${c})`)));
  });
  const stop = () => new Promise((r) => { proc.once('exit', r); proc.kill(); });
  const health = async () => (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
  return { port, stop, health };
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue = [];
    const waiters = [];
    let closeCode = null;
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      const w = waiters.shift();
      if (w) w(m); else queue.push(m);
    });
    ws.on('close', (c) => { closeCode = c; });
    ws.on('error', () => {});
    ws.on('open', () => resolve({
      ws,
      send: (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); },
      next: (ms = 1000) => new Promise((r) => {
        const m = queue.shift();
        if (m) return r(m);
        const fn = (x) => { clearTimeout(t); r(x); };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(fn), 1); r(null); }, ms);
        waiters.push(fn);
      }),
      drain: async (ms = 300) => { const out = []; for (;;) { const m = await (async () => { const x = queue.shift(); if (x) return x; return new Promise((r) => { const fn = (y) => { clearTimeout(t); r(y); }; const t = setTimeout(() => { waiters.splice(waiters.indexOf(fn), 1); r(null); }, ms); waiters.push(fn); }); })(); if (!m) return out; out.push(m); } },
      closed: () => closeCode
    }));
    ws.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('límite de salas: con el máximo alcanzado no se crean más', async (t) => {
  const s = await boot({ MAX_ROOMS: '2' });
  t.after(s.stop);
  const hosts = [];
  for (let i = 0; i < 2; i++) {
    const h = await connect(s.port);
    h.send({ t: 'host' });
    assert.equal((await h.next()).t, 'hosted');
    hosts.push(h);
  }
  const extra = await connect(s.port);
  extra.send({ t: 'host' });
  assert.deepEqual(await extra.next(), { t: 'error', code: 'server_full' });
  const h = await s.health();
  assert.equal(h.rooms, 2);
  assert.equal(h.rejected.server_full, 1);
  for (const c of [...hosts, extra]) c.ws.close();
});

test('límite de identidades por sala; quien vuelve con su secreto siempre entra', async (t) => {
  const s = await boot({ MAX_PEERS_PER_ROOM: '2' });
  t.after(s.stop);
  const host = await connect(s.port);
  host.send({ t: 'host' });
  const hosted = await host.next();
  const peers = [];
  for (const name of ['A', 'B']) {
    const p = await connect(s.port);
    p.send({ t: 'join', room: hosted.room, role: 'player', name });
    peers.push({ c: p, joined: await p.next() });
  }
  const third = await connect(s.port);
  third.send({ t: 'join', room: hosted.room, role: 'player', name: 'C' });
  assert.deepEqual(await third.next(), { t: 'error', code: 'room_full' });
  // A recarga: su identidad ya cuenta, entra igual.
  peers[0].c.ws.close();
  const again = await connect(s.port);
  again.send({ t: 'join', room: hosted.room, role: 'player', name: 'A', pid: peers[0].joined.pid, secret: peers[0].joined.secret });
  assert.equal((await again.next()).pid, peers[0].joined.pid);
  for (const c of [host, peers[1].c, third, again]) c.ws.close();
});

test('límite de conexiones simultáneas', async (t) => {
  const s = await boot({ MAX_CONNECTIONS: '3' });
  t.after(s.stop);
  const cs = [];
  for (let i = 0; i < 3; i++) cs.push(await connect(s.port));
  const extra = await connect(s.port);
  await sleep(200);
  assert.equal(extra.closed(), 1013, 'la cuarta se cierra con "probá más tarde"');
  cs[0].send({ t: 'ping', c: 1 });
  assert.equal((await cs[0].next()).t, 'pong', 'las demás siguen funcionando');
  assert.equal((await s.health()).rejected.connections, 1);
  for (const c of cs) c.ws.close();
});

test('frecuencia: una ráfaga de un celular se recorta y el abuso sostenido cierra la conexión', async (t) => {
  const s = await boot({});
  t.after(s.stop);
  const host = await connect(s.port);
  host.send({ t: 'host' });
  const hosted = await host.next();
  const p = await connect(s.port);
  p.send({ t: 'join', room: hosted.room, role: 'player', name: 'Spam' });
  await p.next();
  await host.next(); // peer
  for (let i = 0; i < 300; i++) p.send({ t: 'msg', data: { k: 'buzz', at: i } });
  const got = (await host.drain(400)).filter((m) => m.t === 'msg');
  assert.ok(got.length <= 25, `al juez llegaron ${got.length} de 300`);
  await sleep(200);
  assert.equal(p.closed(), 1008, 'el servidor corta al que no para');
  const h = await s.health();
  assert.ok(h.rejected.rate >= 200);
  // El juez y la sala siguen bien.
  host.send({ t: 'ping', c: 9 });
  assert.equal((await host.next()).c, 9);
  host.ws.close();
});

test('el uso normal no toca el límite de frecuencia', async (t) => {
  const s = await boot({});
  t.after(s.stop);
  const host = await connect(s.port);
  host.send({ t: 'host' });
  const hosted = await host.next();
  const p = await connect(s.port);
  p.send({ t: 'join', room: hosted.room, role: 'player', name: 'Ana' });
  await p.next();
  await host.next();
  // Como el cliente real: 6 pings seguidos al conectar, y pulsaciones de a una.
  for (let i = 0; i < 6; i++) p.send({ t: 'ping', c: i });
  for (let i = 0; i < 8; i++) { p.send({ t: 'msg', data: { k: 'buzz', at: i } }); await sleep(120); }
  // Y el juez difundiendo estado a cada cambio.
  for (let i = 0; i < 60; i++) host.send({ t: 'msg', to: 'all', data: { k: 'state', state: { phase: 'ready' } } });
  const toHost = (await host.drain(300)).filter((m) => m.t === 'msg');
  assert.equal(toHost.length, 8);
  const toPeer = (await p.drain(300)).filter((m) => m.t === 'msg');
  assert.equal(toPeer.length, 60);
  assert.equal((await s.health()).rejected.rate, 0);
  host.ws.close(); p.ws.close();
});

test('limpieza: identidades desconectadas hace rato salen de la sala', async (t) => {
  const s = await boot({ PEER_TTL_MS: '300', SWEEP_MS: '100' });
  t.after(s.stop);
  const host = await connect(s.port);
  host.send({ t: 'host' });
  const hosted = await host.next();
  const p = await connect(s.port);
  p.send({ t: 'join', room: hosted.room, role: 'player', name: 'Ana' });
  await p.next();
  assert.equal((await s.health()).peers, 1);
  p.ws.close();
  await sleep(700);
  assert.equal((await s.health()).peers, 0);
  host.ws.close();
});

test('/healthz informa salas, conexiones y rechazos', async (t) => {
  const s = await boot({});
  t.after(s.stop);
  const c = await connect(s.port);
  c.send({ t: 'host' });
  await c.next();
  c.send({ t: 'msg', to: 'all', data: { k: 'nada' } });
  await sleep(100);
  const h = await s.health();
  assert.equal(h.ok, true);
  assert.equal(h.rooms, 1);
  assert.equal(h.connections, 1);
  assert.equal(h.rejected.invalid, 1);
  assert.equal(typeof h.uptimeS, 'number');
  c.ws.close();
});
