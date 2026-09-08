import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/game/engine.ts';
import type { Track } from '../src/game/types.ts';

const track = (i: number): Track => ({ id: `t${i}`, uri: `spotify:track:t${i}`, name: `Tema ${i}`, artists: 'X', album: 'A', durationMs: 200000, startMs: 0 });

function setup() {
  let g = E.newGame();
  g = E.addPlayer(g, 'Ana', 'a');
  g = E.addPlayer(g, 'Beto', 'b');
  g = E.addPlayer(g, 'Cami', 'c');
  g = { ...g, tracks: [track(1), track(2)] };
  return E.startGame(g);
}

test('arranca en ready con puntajes en cero', () => {
  const g = setup();
  assert.equal(g.phase, 'ready');
  assert.deepEqual(g.players.map((p) => p.score), [0, 0, 0]);
});

test('la pulsación más rápida gana aunque llegue después', () => {
  let g = E.markPlaying(setup(), 1000);
  g = E.receiveBuzz(g, { playerId: 'b', at: 1500 });
  g = E.receiveBuzz(g, { playerId: 'a', at: 1450 });
  g = E.resolveBuzzes(g, 1600);
  assert.equal(g.phase, 'buzzed');
  assert.equal(g.round.buzzedPlayerId, 'a');
  assert.equal(g.round.events.at(-1)?.reactionMs, 450);
});

test('no se puede tocar si los pulsadores no están abiertos', () => {
  const g = E.receiveBuzz(setup(), { playerId: 'a', at: 1 });
  assert.equal(g.round.pending.length, 0);
});

test('acierto suma, revela y pasa de tema', () => {
  let g = E.markPlaying(setup());
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'a', at: 5 }));
  g = E.judgeCorrect(g);
  assert.equal(g.phase, 'revealed');
  assert.equal(g.players[0].score, 1);
  assert.equal(E.toPublic(g).revealed?.name, 'Tema 1');
  g = E.nextTrack(g);
  assert.equal(g.phase, 'ready');
  assert.equal(g.round.trackIndex, 1);
  assert.equal(g.history.length, 1);
});

test('error resta, bloquea al jugador y deja abierto para el resto', () => {
  let g = E.markPlaying(setup());
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'b', at: 5 }));
  g = E.judgeWrong(g);
  assert.equal(g.phase, 'open');
  assert.equal(g.players[1].score, -1);
  assert.ok(g.round.lockedPlayerIds.includes('b'));
  assert.equal(E.canBuzz(g, 'b'), false);
  assert.equal(E.canBuzz(g, 'a'), true);
  // pasada más larga
  g = E.nextStep(g);
  assert.equal(g.round.step, 1);
  assert.equal(E.stepMs(g.settings, g.round.step), 1200);
});

test('tarareo aplica su propia penalización', () => {
  let g = E.markPlaying({ ...setup(), settings: { ...E.newGame().settings, pointsHum: -2 } });
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'c', at: 5 }));
  g = E.judgeHum(g);
  assert.equal(g.players[2].score, -2);
});

test('puntos por pasada configurables', () => {
  let g = { ...setup(), settings: { ...E.newGame().settings, pointsCorrect: [3, 2, 1] } };
  g = E.nextStep(E.markSnippetEnded(E.markPlaying(g)));
  g = E.markPlaying(g);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'a', at: 5 }));
  g = E.judgeCorrect(g);
  assert.equal(g.players[0].score, 2);
});

test('el título nunca sale en el estado público antes de revelar', () => {
  let g = E.markPlaying(setup());
  const pub = JSON.stringify(E.toPublic(g));
  assert.ok(!pub.includes('Tema 1'));
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'a', at: 5 }));
  assert.ok(!JSON.stringify(E.toPublic(g)).includes('Tema 1'));
});

test('termina al pasar el último tema y calcula estadísticas', () => {
  let g = E.markPlaying(setup(), 0);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'a', at: 300 }));
  g = E.nextTrack(E.judgeCorrect(g));
  g = E.markPlaying(g, 0);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'b', at: 100 }));
  g = E.judgeWrong(g);
  g = E.nextTrack(E.reveal(g));
  assert.equal(g.phase, 'finished');
  const st = E.computeStats(g);
  assert.equal(st.ranking[0].id, 'a');
  assert.equal(st.fastest?.player.id, 'a');
  assert.equal(st.fastest?.reactionMs, 300);
  assert.equal(st.mostNegative?.id, 'b');
  assert.equal(st.unsolved, 1);
  assert.ok(E.toPublic(g).awards?.some((a) => a.v === 'Ana'));
});
