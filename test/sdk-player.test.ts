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
/** Respuesta de la API simulada; por defecto todo OK (204). */
let respond: (url: string, method: string) => Response | 'colgado' = () => new Response(null, { status: 204 });
g.fetch = async (url: string, init: RequestInit = {}) => {
  const method = init.method ?? 'GET';
  calls.push(`${method} ${String(url).replace('https://api.spotify.com/v1', '')}`);
  const r = respond(String(url), method);
  // 'colgado': Spotify nunca contesta; sólo termina si el pedido se aborta.
  if (r === 'colgado') return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  return r;
};
const deviceNotFound = () => new Response(JSON.stringify({ error: { status: 404, message: 'Device not found' } }), { status: 404 });

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
  const calls: string[] = [];
  const fake = {
    pause: async () => { pauses++; },
    resume: async () => { calls.push('resume'); },
    activateElement: async () => { calls.push('activar'); }
  };
  Object.assign(p, { ready: true, deviceId: 'dev', player: fake });
  return { p, pauses: () => pauses, calls };
}

beforeEach(() => {
  calls.length = 0;
  respond = () => new Response(null, { status: 204 });
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

test('sin confirmación del SDK, el fragmento se corta igual a tiempo y se pausa también por la API', async () => {
  const { p, pauses } = ready();
  const s = track(p.playSnippet('spotify:track:x', 0, 400));
  await flush();
  mock.timers.tick(2000); // no llega ningún evento del SDK
  await flush();
  assert.equal(s.done, false, 'todavía falta el fragmento');
  mock.timers.tick(400);
  await flush();
  assert.equal(s.value, 'done');
  assert.equal(pauses(), 1);
  assert.ok(calls.includes('PUT /me/player/pause'), 'pausa el dispositivo activo de la cuenta, esté donde esté');
  assert.equal(p.pendingWaits, 0);
});

test('"Parar" pausa el navegador y el dispositivo activo de la cuenta', async () => {
  const { p, pauses } = ready();
  await p.stop();
  assert.equal(pauses(), 1);
  assert.ok(calls.includes('PUT /me/player/pause'));
});

test('Device not found: transfiere la reproducción al navegador y reintenta', async () => {
  const { p } = ready();
  let plays = 0;
  respond = (url, method) => (method === 'PUT' && url.includes('/me/player/play') && plays++ === 0 ? deviceNotFound() : new Response(null, { status: 204 }));
  const s = track(p.playSnippet('spotify:track:x', 0, 400));
  await flush();
  mock.timers.tick(700);
  await flush();
  p.handleState(state('spotify:track:x', 10) as never);
  await flush();
  mock.timers.tick(400);
  await flush();
  assert.equal(s.value, 'done');
  assert.deepEqual(calls.filter((c) => !c.includes('pause')), ['PUT /me/player/play?device_id=dev', 'PUT /me/player', 'PUT /me/player/play?device_id=dev']);
});

test('Device not found persistente: reconecta el SDK y, si no alcanza, lo dice claro', async () => {
  const { p } = ready();
  let reconnects = 0;
  Object.assign(p, { reconnect: async () => { reconnects++; } });
  respond = (url, method) => (method === 'PUT' && url.includes('/me/player/play') ? deviceNotFound() : new Response(null, { status: 204 }));
  const s = track(p.playSnippet('spotify:track:x', 0, 400));
  for (let i = 0; i < 4; i++) { await flush(); mock.timers.tick(700); }
  await flush();
  assert.equal(reconnects, 1);
  assert.match(String(s.error), /no encuentra el reproductor/);
  assert.equal(p.pendingWaits, 0);
});

test('si Spotify no contesta la pausa, el fragmento termina igual y el panel no queda trabado', async () => {
  const p = new SdkPlayer();
  // El SDK desconectado: pause() nunca resuelve. Y la API tampoco contesta la pausa.
  Object.assign(p, { ready: true, deviceId: 'dev', player: { pause: () => new Promise(() => {}) } });
  respond = (url, method) => (method === 'PUT' && url.includes('/pause') ? 'colgado' : new Response(null, { status: 204 }));
  const s = track(p.playSnippet('spotify:track:x', 0, 400));
  await flush();
  p.handleState(state('spotify:track:x', 50) as never);
  for (let i = 0; i < 40 && !s.done; i++) { mock.timers.tick(1000); await flush(); }
  assert.equal(s.done, true, 'playSnippet terminó aunque Spotify no respondió la pausa');
  const st = track(p.stop());
  for (let i = 0; i < 40 && !st.done; i++) { mock.timers.tick(1000); await flush(); }
  assert.equal(st.done, true, 'stop() también termina');
});

test('iPhone: el sonido se habilita dentro del toque (antes de cualquier espera) y un tema que llega en pausa se reanuda', async () => {
  const { p, calls } = ready();
  const s = track(p.playSnippet('spotify:track:x', 0, 400));
  assert.deepEqual(calls, ['activar'], 'activateElement en el mismo momento del toque');
  await flush();
  p.handleState(state('spotify:track:x', 0, true) as never); // llegó cargado pero en pausa
  await flush();
  assert.deepEqual(calls, ['activar', 'resume']);
  p.handleState(state('spotify:track:x', 20) as never);
  await flush();
  mock.timers.tick(400);
  await flush();
  assert.equal(s.value, 'done');
});
