// Efectos de sonido sintetizados con Web Audio: sin archivos, funcionan offline.
import type { SfxName } from '../net/protocol';

let ctx: AudioContext | undefined;

export function unlockAudio() {
  ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', gain = 0.25, slideTo?: number) {
  const c = unlockAudio();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

function noise(start: number, dur: number, gain = 0.2) {
  const c = unlockAudio();
  const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource();
  s.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 800;
  s.connect(f).connect(g).connect(c.destination);
  s.start(c.currentTime + start);
}

/** Cada jugador tiene su tono de pulsador según su índice. */
export function buzzerTone(index: number) {
  const base = [440, 523, 587, 659, 698, 784, 880, 988][index % 8];
  tone(base, 0, 0.35, 'square', 0.3);
  tone(base * 1.5, 0.05, 0.3, 'square', 0.12);
}

export function playSfx(name: SfxName, playerIndex = 0) {
  try {
    switch (name) {
      case 'buzz': buzzerTone(playerIndex); break;
      case 'correct':
        [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.25, 'triangle', 0.3));
        tone(1319, 0.4, 0.5, 'triangle', 0.25);
        break;
      case 'wrong':
        tone(220, 0, 0.5, 'sawtooth', 0.3, 110);
        tone(233, 0, 0.5, 'sawtooth', 0.2, 116);
        break;
      case 'hum':
        [330, 294, 262].forEach((f, i) => tone(f, i * 0.12, 0.18, 'square', 0.25));
        break;
      case 'reveal':
        for (let i = 0; i < 12; i++) noise(i * 0.08, 0.06, 0.15);
        tone(784, 1.0, 0.6, 'triangle', 0.3);
        break;
      case 'start':
        tone(660, 0, 0.08, 'sine', 0.2);
        tone(880, 0.1, 0.12, 'sine', 0.2);
        break;
      case 'tick': tone(1200, 0, 0.04, 'sine', 0.12); break;
      case 'finish':
        [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.4, 'triangle', 0.3));
        break;
    }
  } catch { /* sin audio */ }
}
