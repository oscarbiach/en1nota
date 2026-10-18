// Reproductor «Vista previa»: el MP3 de muestra de Spotify suena en un <audio>
// de la página y el fragmento se corta acá mismo. <audio> y servidor simulados.
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const log: string[] = [];
let playRejects: Error | undefined;
class FakeAudio {
  src = '';
  preload = '';
  currentTime = 5;
  play() { log.push(`play ${this.src.startsWith('data:') ? 'silencio' : this.src}`); return playRejects ? Promise.reject(playRejects) : Promise.resolve(); }
  pause() { log.push('pausa'); }
}
const g = globalThis as unknown as Record<string, unknown>;
g.Audio = FakeAudio;
let previews: Record<string, unknown> = {};
let asked = 0;
g.fetch = async (url: string) => {
  asked++;
  const id = String(url).split('/').pop()!;
  const j = previews[id];
  return j ? new Response(JSON.stringify(j), { status: 200 }) : new Response(JSON.stringify({ error: 'sin_vista_previa' }), { status: 404 });
};

const { PreviewPlayer } = await import('../src/spotify/preview.ts');

const ID = 'a'.repeat(22);
const URI = `spotify:track:${ID}`;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r)); };
async function run<T>(p: Promise<T>, step = 100) {
  const s: { done: boolean; value?: T; error?: Error } = { done: false };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  for (let i = 0; i < 100 && !s.done; i++) { await flush(); mock.timers.tick(step); }
  return s;
}

beforeEach(() => {
  log.length = 0; playRejects = undefined; asked = 0;
  previews = { [ID]: { url: 'https://p.scdn.co/mp3-preview/abc' } };
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
});

test('activar desde un toque desbloquea el audio con un silencio', async () => {
  const p = new PreviewPlayer();
  await run(p.init());
  assert.equal(p.ready, true);
  assert.deepEqual(log, ['play silencio', 'pausa']);
});

test('fragmento: suena la vista previa desde el principio y se corta acá a los 400 ms', async () => {
  const p = new PreviewPlayer();
  await run(p.init());
  log.length = 0;
  const s = track(p.playSnippet(URI, 90_000, 400));
  await flush(); await flush();
  assert.deepEqual(log, ['play https://p.scdn.co/mp3-preview/abc']);
  mock.timers.tick(399); await flush();
  assert.equal(s.done, false, 'todavía no se cortó');
  mock.timers.tick(1); await flush();
  assert.equal(s.value, 'done');
  assert.deepEqual(log, ['play https://p.scdn.co/mp3-preview/abc', 'pausa']);
  await run(p.playSnippet(URI, 0, 400));
  assert.equal(asked, 1, 'el enlace se pide una sola vez por tema');
});

test('Parar corta la vista previa en el momento', async () => {
  const p = new PreviewPlayer();
  await run(p.init());
  const s = track(p.playSnippet(URI, 0, 8000));
  await flush(); await flush();
  await p.stop();
  await flush();
  assert.equal(s.value, 'cancelled');
  assert.equal(log.at(-1), 'pausa');
});

test('un tema sin vista previa avisa qué hacer', async () => {
  previews = {};
  const p = new PreviewPlayer();
  await run(p.init());
  const r = await run(p.playSnippet(URI, 0, 400));
  assert.match(r.error?.message ?? '', /no tiene vista previa.*Saltar tema/);
});

test('un tema agregado a mano no se puede tocar en vista previa', async () => {
  const p = new PreviewPlayer();
  await run(p.init());
  const r = await run(p.playSnippet('manual:x', 0, 400));
  assert.match(r.error?.message ?? '', /sólo suenan temas de Spotify/);
});

test('si el celular no deja sonar, lo dice', async () => {
  const p = new PreviewPlayer();
  await run(p.init());
  playRejects = Object.assign(new Error('no'), { name: 'NotAllowedError' });
  const r = await run(p.playSnippet(URI, 0, 400));
  assert.match(r.error?.message ?? '', /no dejó sonar.*Reactivar/);
});

function track<T>(p: Promise<T>) {
  const s: { done: boolean; value?: T; error?: unknown } = { done: false };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
}
