// En iPhone, cualquier audio de la página (los efectos del juego) le corta la
// música a la app de Spotify, y en segundo plano Spotify ya no puede volver a
// sonar (caso real 2026-10-18). Con la página en silencio no se crea ni se
// reactiva el audio. AudioContext simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';

let created = 0;
let closed = 0;
class FakeNode { connect(n: unknown) { return n; } start() {} stop() {} frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 }; type = ''; }
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  constructor() { created++; }
  createOscillator() { return new FakeNode(); }
  createGain() { return new FakeNode(); }
  resume() { return Promise.resolve(); }
  close() { closed++; this.state = 'closed'; return Promise.resolve(); }
}
const g = globalThis as unknown as Record<string, unknown>;
g.window = { AudioContext: FakeAudioContext };

const { playSfx, setPageAudio, unlockAudio } = await import('../src/audio/sfx.ts');

test('con la página en silencio, los efectos no abren audio y el que había se cierra', () => {
  playSfx('start');
  assert.equal(created, 1, 'normalmente el efecto abre el audio de la página');
  setPageAudio(false);
  assert.equal(closed, 1, 'se cierra para devolverle el sonido a Spotify');
  playSfx('correct');
  playSfx('buzz');
  assert.equal(unlockAudio(), undefined, 'tocar la pantalla tampoco lo reactiva');
  assert.equal(created, 1, 'no se vuelve a abrir');
  setPageAudio(true);
  playSfx('start');
  assert.equal(created, 2, 'al volver a permitirlo, los efectos suenan de nuevo');
});
