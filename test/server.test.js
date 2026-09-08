import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 8790 + Math.floor(Math.random() * 100);

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const queue = [];
    const waiters = [];
    ws.on('message', (d) => { const m = JSON.parse(d.toString()); const w = waiters.shift(); w ? w(m) : queue.push(m); });
    ws.on('open', () => resolve({
      ws,
      send: (o) => ws.send(JSON.stringify(o)),
      next: () => new Promise((r) => { const m = queue.shift(); m ? r(m) : waiters.push(r); })
    }));
    ws.on('error', reject);
  });
}

test('sala: host, jugador, relay y reloj', async () => {
  const proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => proc.stdout.on('data', (d) => d.toString().includes('escuchando') && r()));
  try {
    const host = await connect();
    host.send({ t: 'ping', c: 123 });
    const pong = await host.next();
    assert.equal(pong.t, 'pong'); assert.equal(pong.c, 123); assert.ok(pong.s > 0);

    host.send({ t: 'host' });
    const hosted = await host.next();
    assert.equal(hosted.t, 'hosted'); assert.match(hosted.room, /^[A-Z]{4}$/);

    const player = await connect();
    player.send({ t: 'join', room: hosted.room.toLowerCase(), role: 'player', name: 'Ana' });
    const joined = await player.next();
    assert.equal(joined.t, 'joined'); assert.equal(joined.hostOnline, true);
    const peer = await host.next();
    assert.equal(peer.t, 'peer'); assert.equal(peer.name, 'Ana'); assert.equal(peer.connected, true);

    player.send({ t: 'msg', data: { k: 'buzz', at: 5 } });
    const relayed = await host.next();
    assert.equal(relayed.t, 'msg'); assert.equal(relayed.from, joined.pid); assert.equal(relayed.data.k, 'buzz'); assert.ok(relayed.at > 0);

    host.send({ t: 'msg', to: 'all', data: { k: 'state', state: { phase: 'ready' } } });
    const st = await player.next();
    assert.equal(st.data.state.phase, 'ready');

    const ghost = await connect();
    ghost.send({ t: 'join', room: 'ZZZZ', role: 'player', name: 'X' });
    assert.equal((await ghost.next()).code, 'no_room');

    // host resume con clave
    host.ws.close();
    assert.equal((await player.next()).t, 'host_gone');
    const host2 = await connect();
    host2.send({ t: 'host', room: hosted.room, key: hosted.key });
    const re = await host2.next();
    assert.equal(re.room, hosted.room); assert.equal(re.peers.length, 1);
    assert.equal((await player.next()).t, 'host_back');

    host2.send({ t: 'close_room' });
    assert.equal((await player.next()).t, 'room_closed');
    for (const c of [player, ghost, host2]) c.ws.close();
  } finally {
    proc.kill();
  }
});
