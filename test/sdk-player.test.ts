// Regresión B01 (segunda auditoría): la espera del SDK sólo se completa con
// un evento nuevo del tema pedido, y nunca deja listeners colgados.
// SdkPlayer real con un reproductor y una API de Spotify simulados.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };
mem.set('en1nota.spotify.token', JSON.stringify({ accessToken: 'FICTICIO', expiresAt: Date.now() + 3_600_000 }));
const calls: string[] = [];
g.fetch = async (url: string) => { calls.push(String(url)); return new Response(null, { status: 204 }); };

const { SdkPlayer } = await import('../src/spotify/player.ts');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)); };
function track<T>(p: Promise<T>) {
  const s: { done: boolean; value?: T; error?: unknown } = { done: false };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
}
function state(uri: string, position: number, paused = false, linkedFrom?: string) {
  return { paused, position, duration: 200_000, timestamp: 0, track_window: { current_track: { uri, id: null, name: '', duration_ms: 200_000, ...(linkedFrom ? { linked_from: { uri: linkedFrom, id: null } } : {}) } } };
}
function ready() {
  const p = new SdkPlayer();
  let pauses = 0;
  const fake = { pause: async () => { pauses++; } };
  Object.assign(p, { ready: true, deviceId: 'dev', player: fake });
  return { p, pauses: () => pauses };
}

beforeEach(() => {
  calls.length = 0;
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
});

test('B01: un evento de otra canción no completa la espera', async () => {
  const { p, pauses } = ready();
  const s = track(p.playSnippet('spotify:track:expected', 10_000, 400));
  await flush();
  p.handleState(state('spotify:track:old', 90_000) as never); // el caso de la auditoría
  mock.timers.tick(1000);
  await flush();
  assert.equal(pauses(), 0, 'no pausa por un tema ajeno');
  assert.equal(s.done, false);
  p.handleState(state('spotify:track:expected', 10_050) as never);
  await flush();
  mock.timers.tick(350);
  await flush();
  assert.equal(s.value, 'done');
  assert.equal(pauses(), 1);
  assert.equal(p.pendingWaits, 0);
});

test('B01: el estado guardado de una reproducción anterior del mismo tema no cuenta', async () => {
  const { p, pauses } = ready();
  p.handleState(state('spotify:track:expected', 10_300) as never); // quedó sonando de antes
  const s = track(p.playSnippet('spotify:track:expected', 10_000, 400));
  await flush();
  mock.timers.tick(600);
  await flush();
  assert.equal(pauses(), 0, 'sin evento nuevo no arranca a contar');
  p.handleState(state('spotify:track:expected', 10_020) as never);
  await flush();
  mock.timers.tick(400);
  await flush();
  assert.equal(s.value, 'done');
});

test('B01: eventos pausados o lejos de la posición pedida no cuentan; linked_from sí', async () => {
  const { p } = ready();
  const s = track(p.playSnippet('spotify:track:pedido', 30_000, 400));
  await flush();
  p.handleState(state('spotify:track:pedido', 30_000, true) as never);
  p.handleState(state('spotify:track:pedido', 120_000) as never);
  await flush();
  mock.timers.tick(1000);
  await flush();
  assert.equal(s.done, false);
  p.handleState(state('spotify:track:regional', 30_010, false, 'spotify:track:pedido') as never);
  await flush();
  mock.timers.tick(400);
  await flush();
  assert.equal(s.value, 'done');
});

test('B01: cancelar libera la espera', async () => {
  const { p } = ready();
  const s = track(p.playSnippet('spotify:track:x', 0, 400));
  await flush();
  assert.equal(p.pendingWaits, 1);
  await p.stop();
  await flush();
  assert.equal(s.value, 'cancelled');
  assert.equal(p.pendingWaits, 0);
});

test('B01: si Spotify no arranca, vence con error y libera la espera', async () => {
  const { p } = ready();
  const s = track(p.playSnippet('spotify:track:x', 0, 400));
  await flush();
  mock.timers.tick(6000);
  await flush();
  assert.match(String(s.error), /no arrancó/);
  assert.equal(p.pendingWaits, 0);
});
