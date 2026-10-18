// Spotify Connect: la música va al aparato que eligió el juez, no al que
// Spotify tenga como activo (caso real 2026-10-18: sonaba en un Echo Pop en
// vez del iPhone del juez). API de Spotify simulada; sin red.
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };
mem.set('en1nota.spotify.token', JSON.stringify({ accessToken: 'FICTICIO', expiresAt: Date.now() + 3_600_000 }));

const echo = { id: 'echo', name: 'Echo Pop de Oscar', type: 'Speaker', is_active: true };
const phone = { id: 'iphone', name: 'iPhone de Oscar', type: 'Smartphone', is_active: false };
let list = [echo, phone];
let missing = new Set<string>();
const plays: string[] = [];
/** Orden de los pedidos: 'play', 'estado:si'/'estado:no', 'pausa'. */
const log: string[] = [];
/** Cuántas consultas de estado tarda el aparato en sonar (Infinity = dormido). */
let startsAfterPolls = 0;
let polls = 0;
let last: { uri: string; device: string; position: number } | undefined;
g.fetch = async (url: string, init: RequestInit = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? 'GET';
  if (u.pathname.endsWith('/me/player/devices')) return new Response(JSON.stringify({ devices: list }), { status: 200 });
  if (u.pathname.endsWith('/me/player/play')) {
    const id = u.searchParams.get('device_id') ?? '';
    if (missing.has(id)) return new Response(JSON.stringify({ error: { status: 404, message: 'Device not found' } }), { status: 404 });
    plays.push(id);
    log.push('play');
    last = { uri: JSON.parse(String(init.body)).uris[0], device: id, position: JSON.parse(String(init.body)).position_ms };
    polls = 0;
  }
  if (u.pathname.endsWith('/me/player/pause')) log.push('pausa');
  if (u.pathname.endsWith('/me/player') && method === 'GET') {
    const on = !!last && ++polls > startsAfterPolls;
    log.push(on ? 'estado:si' : 'estado:no');
    if (!on) return new Response(null, { status: 204 }); // nada sonando
    return new Response(JSON.stringify({ is_playing: true, progress_ms: last!.position + 100, item: { uri: last!.uri }, device: { id: last!.device } }), { status: 200 });
  }
  return new Response(null, { status: 204 });
};
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)); };
async function run<T>(p: Promise<T>) {
  const s: { done: boolean; value?: T; error?: Error } = { done: false };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  for (let i = 0; i < 60 && !s.done; i++) { await flush(); mock.timers.tick(200); }
  return s;
}

const { ConnectPlayer } = await import('../src/spotify/player.ts');

beforeEach(() => {
  list = [echo, phone]; missing = new Set(); plays.length = 0; log.length = 0; startsAfterPolls = 0; last = undefined;
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
});

test('sin elección guardada usa el aparato activo y dice cuál es', async () => {
  const p = new ConnectPlayer();
  await p.init();
  assert.equal(p.deviceId, 'echo');
  assert.equal(p.deviceName, 'Echo Pop de Oscar');
});

test('con el aparato elegido guardado, suena ahí aunque Spotify tenga otro activo', async () => {
  const p = new ConnectPlayer(undefined, { id: 'iphone', name: 'iPhone de Oscar' });
  await p.init();
  await p.play('spotify:track:x', 0);
  assert.deepEqual(plays, ['iphone']);
});

test('si el aparato elegido cambió de id, lo reconoce por el nombre', async () => {
  list = [echo, { ...phone, id: 'iphone-nuevo' }];
  const p = new ConnectPlayer(undefined, { id: 'iphone', name: 'iPhone de Oscar' });
  await p.init();
  assert.equal(p.deviceId, 'iphone-nuevo');
});

test('si Spotify pierde el aparato en plena partida, vuelve al mismo (por nombre) y no al activo', async () => {
  const p = new ConnectPlayer(phone);
  await p.init();
  missing.add('iphone');
  list = [echo, { ...phone, id: 'iphone-2' }];
  await p.play('spotify:track:x', 0);
  assert.deepEqual(plays, ['iphone-2']);
});

test('fragmento por Connect: se cuenta desde que el aparato suena; la pausa nunca llega antes', async () => {
  startsAfterPolls = 3; // el celular tarda en arrancar
  const p = new ConnectPlayer(phone);
  const status: string[] = [];
  p.onStatus = (m) => status.push(m);
  await p.init();
  const r = await run(p.playSnippet('spotify:track:x', 10_000, 400));
  assert.equal(r.value, 'done', String(r.error?.message));
  assert.match(status.at(-1) ?? '', /Spotify confirmó el último fragmento/, 'el juez ve qué dijo Spotify');
  assert.deepEqual(log, ['play', 'estado:no', 'estado:no', 'estado:no', 'estado:si', 'pausa']);
});

test('si el aparato no arranca (iPhone con Spotify dormido), avisa qué hacer en vez de quedarse callado', async () => {
  startsAfterPolls = Infinity;
  const p = new ConnectPlayer(phone);
  await p.init();
  const r = await run(p.playSnippet('spotify:track:x', 0, 400));
  assert.match(r.error?.message ?? '', /no empezó a sonar.*dejá un tema sonando/s);
  assert.equal(log.at(-1), 'pausa', 'por si arranca tarde, igual se pausa');
});
