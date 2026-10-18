// Spotify Connect: la música va al aparato que eligió el juez, no al que
// Spotify tenga como activo (caso real 2026-10-18: sonaba en un Echo Pop en
// vez del iPhone del juez). API de Spotify simulada; sin red.
import { test, beforeEach } from 'node:test';
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
g.fetch = async (url: string, init: RequestInit = {}) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/me/player/devices')) return new Response(JSON.stringify({ devices: list }), { status: 200 });
  if (u.pathname.endsWith('/me/player/play')) {
    const id = u.searchParams.get('device_id') ?? '';
    if (missing.has(id)) return new Response(JSON.stringify({ error: { status: 404, message: 'Device not found' } }), { status: 404 });
    plays.push(id);
  }
  void init;
  return new Response(null, { status: 204 });
};

const { ConnectPlayer } = await import('../src/spotify/player.ts');

beforeEach(() => { list = [echo, phone]; missing = new Set(); plays.length = 0; });

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
