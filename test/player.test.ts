// Regresión A01: cancelar un fragmento nunca deja promesas pendientes, y un
// timer viejo nunca corta un fragmento nuevo. Reloj simulado, sin Spotify.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ManualPlayer } from '../src/spotify/manual.ts';
import { Op, Runner, runSnippet } from '../src/spotify/run.ts';

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
});

/** Estado de una promesa sin esperarla. */
function track<T>(p: Promise<T>) {
  const s: { done: boolean; value?: T; error?: unknown } = { done: false };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
}
const flush = () => new Promise<void>((r) => setImmediate(r));

test('A01: parar durante el fragmento resuelve la promesa como cancelada', async () => {
  const p = new ManualPlayer();
  const s = track(p.playSnippet('u', 0, 3000));
  mock.timers.tick(1000);
  await p.stop();
  await flush();
  assert.equal(s.done, true, 'la promesa no puede quedar pendiente');
  assert.equal(s.value, 'cancelled');
});

test('A01: el fragmento que termina solo resuelve "done"', async () => {
  const p = new ManualPlayer();
  const s = track(p.playSnippet('u', 0, 400));
  mock.timers.tick(399);
  await flush();
  assert.equal(s.done, false);
  mock.timers.tick(1);
  await flush();
  assert.equal(s.value, 'done');
});

test('A01: un fragmento nuevo cancela el anterior y su timer no lo corta', async () => {
  const p = new ManualPlayer();
  const viejo = track(p.playSnippet('u', 0, 3000));
  mock.timers.tick(1000);
  const nuevo = track(p.playSnippet('u', 0, 3000));
  await flush();
  assert.equal(viejo.value, 'cancelled');
  mock.timers.tick(2500); // acá habría vencido el timer viejo
  await flush();
  assert.equal(nuevo.done, false, 'el timer viejo no termina el fragmento nuevo');
  mock.timers.tick(500);
  await flush();
  assert.equal(nuevo.value, 'done');
});

test('A01: destroy también libera la operación pendiente', async () => {
  const p = new ManualPlayer();
  const s = track(p.playSnippet('u', 0, 8000));
  p.destroy();
  await flush();
  assert.equal(s.value, 'cancelled');
});

test('Op.wait: una promesa externa colgada no bloquea la cancelación', async () => {
  const r = new Runner();
  const op = r.begin();
  let rejectLate!: (e: Error) => void;
  const colgada = new Promise<void>((_, rej) => { rejectLate = rej; });
  const s = track(runSnippet(() => op.wait(colgada)));
  r.cancel();
  await flush();
  assert.equal(s.value, 'cancelled');
  // Si la promesa externa falla después, no hay rechazo sin manejar.
  rejectLate(new Error('Spotify no arrancó a reproducir'));
  await flush();
});

test('Op: los errores reales se propagan', async () => {
  const op = new Op();
  const s = track(runSnippet(() => op.wait(Promise.reject(new Error('403')))));
  await flush();
  assert.match(String(s.error), /403/);
});
