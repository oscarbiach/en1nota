import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/game/engine.ts';
import { parseGame } from '../src/storage/schema.ts';

function game(mode: 'party' | 'solo' | 'duel' = 'party') {
  let g = E.newGame({ mode, tracks: [1, 2].map((n) => ({ id: String(n), uri: `manual:${n}`, name: 'Música Ligera', artists: 'Artista', album: '', durationMs: 180000, startMs: 0 })) });
  for (const id of ['a', 'b', 'c', 'd'].slice(0, mode === 'party' ? 4 : E.playerLimit(g))) g = E.addPlayer(g, id, id);
  return E.markPlaying(E.startGame(g), 1000);
}

test('la cola conserva los toques, promueve por orden y deja tocar al resto', () => {
  let g = game();
  g = E.receiveBuzz(g, { playerId: 'b', at: 1200 });
  g = E.receiveBuzz(g, { playerId: 'a', at: 1100 });
  g = E.resolveBuzzes(g, 1300);
  assert.equal(g.round.buzzedPlayerId, 'a');
  assert.deepEqual(E.toPublic(g).queuedPlayerIds, ['b']);
  for (const id of ['a', 'b']) assert.equal(E.canBuzz(g, id), false);
  assert.equal(E.canBuzz(g, 'c'), true);
  g = E.receiveBuzz(g, { playerId: 'c', at: 1400 });
  assert.equal(E.receiveBuzz(g, { playerId: 'c', at: 100 }), g, 'no se adelanta con un segundo toque');
  g = E.judgeWrong(g, 2000);
  assert.equal(g.phase, 'buzzed');
  assert.equal(g.round.buzzedPlayerId, 'b');
  assert.equal(g.round.events.at(-1)?.reactionMs, 200, 'conserva el instante original de pulsación');
  assert.equal(E.canBuzz(g, 'a'), false);
  assert.equal(E.canBuzz(g, 'd'), true);
  g = E.judgeTimeout(g, 3000);
  assert.equal(g.round.buzzedPlayerId, 'c');
  g = E.judgeWrong(g, 4000);
  assert.equal(g.phase, 'open');
  assert.deepEqual(g.players.map((p) => p.score), [-1, -1, -1, 0]);
  assert.equal(E.canBuzz(g, 'd'), true);
});

test('empates exactos mantienen orden de llegada; acierto y siguiente limpian la cola', () => {
  let g = game();
  for (const playerId of ['c', 'b', 'a']) g = E.receiveBuzz(g, { playerId, at: 1200 });
  g = E.resolveBuzzes(g);
  assert.equal(g.round.buzzedPlayerId, 'c');
  assert.deepEqual(E.toPublic(g).queuedPlayerIds, ['b', 'a']);
  g = E.judgeCorrect(g);
  assert.deepEqual(E.toPublic(g).queuedPlayerIds, []);
  g = E.markPlaying(E.nextTrack(g));
  assert.ok(g.players.every((p) => E.canBuzz(g, p.id)));
});

test('repetir o alargar durante la ventana no descarta pulsaciones recibidas', () => {
  const g = E.receiveBuzz(E.markSnippetEnded(game()), { playerId: 'a', at: 1200 });
  assert.equal(E.markPlaying(g), g);
  assert.equal(E.nextStep(g), g);
  assert.equal(E.resolveBuzzes(g).round.buzzedPlayerId, 'a');
});

test('terminar durante un turno cierra la cola pública y el historial', () => {
  let g = game();
  for (const playerId of ['a', 'b']) g = E.receiveBuzz(g, { playerId, at: 1200 });
  g = E.finishGame(E.resolveBuzzes(g));
  assert.deepEqual(E.toPublic(g).queuedPlayerIds, []);
  assert.equal(E.toPublic(g).buzzedPlayerId, undefined);
  assert.deepEqual(g.history[0].queue, []);
});

test('recargar, reasignar y quitar jugadores mantiene una cola utilizable', () => {
  let g = game();
  for (const [i, playerId] of ['a', 'b', 'c'].entries()) g = E.receiveBuzz(g, { playerId, at: 1200 + i });
  g = E.resolveBuzzes(g);
  g = E.restoreGame(parseGame(JSON.parse(JSON.stringify(g)))!);
  assert.deepEqual(E.toPublic(g).queuedPlayerIds, ['b', 'c']);
  g = E.reassignPlayer(g, 'b', 'nuevo');
  g = E.removePlayer(g, 'a');
  assert.equal(g.round.buzzedPlayerId, 'nuevo');
  g = E.removePlayer(g, 'c');
  assert.deepEqual(E.toPublic(g).queuedPlayerIds, []);
  g = E.judgeWrong(g);
  assert.equal(g.phase, 'open');
});

test('sin bloqueo configurado, el que falló puede volver detrás de la cola', () => {
  let g = game(); g.settings = { ...g.settings, lockOnFail: false };
  for (const playerId of ['a', 'b']) g = E.receiveBuzz(g, { playerId, at: 1200 });
  g = E.judgeWrong(E.resolveBuzzes(g));
  assert.equal(g.round.buzzedPlayerId, 'b');
  assert.equal(E.canBuzz(g, 'a'), true);
});

test('duelo cierra respuestas antes de mostrar y conserva turno del rival', () => {
  let g = game('duel');
  for (const playerId of ['a', 'b']) g = E.receiveBuzz(g, { playerId, at: 1200 });
  g = E.checkAnswer(E.resolveBuzzes(g));
  assert.equal(E.toPublic(g).revealed, undefined, 'el título no viaja a celulares antes del resultado');
  assert.equal(E.toPublic(g).answersClosed, true);
  g = E.judgeWrong(g);
  assert.equal(g.round.buzzedPlayerId, 'b');
  assert.equal(E.canBuzz(g, 'a'), false);
  g = E.judgeCorrect(g);
  assert.deepEqual(g.players.map((p) => p.score), [-1, 1]);
});

test('duelo con ambos fallidos revela; límites de jugadores no dependen del botón', () => {
  let g = game('duel');
  assert.equal(E.addPlayer(g, 'extra'), g);
  assert.equal(E.startGame({ ...g, phase: 'lobby', players: g.players.slice(0, 1) }).phase, 'lobby');
  for (const playerId of ['a', 'b']) g = E.receiveBuzz(g, { playerId, at: 1200 });
  g = E.judgeWrong(E.checkAnswer(E.resolveBuzzes(g)));
  g = E.judgeWrong(g);
  assert.equal(g.phase, 'revealed');
  assert.deepEqual(g.players.map((p) => p.score), [-1, -1]);
});

test('solitario escrito compara sin tildes, signos o mayúsculas y contabiliza una sola vez', () => {
  let g = game('solo');
  assert.equal(E.canBuzz(g, 'a'), false);
  assert.equal(E.submitSoloAnswer(g, '', 2000), g);
  assert.ok(E.matchesTitle(' ¡MUSICA   LIGERA! ', 'Música Ligera'));
  assert.equal(E.matchesTitle('Música', 'Música Ligera'), false);
  g = E.submitSoloAnswer(g, 'musica ligera', 2000);
  assert.equal(g.phase, 'revealed');
  assert.equal(g.players[0].score, 1);
  assert.equal(E.submitSoloAnswer(g, 'musica ligera', 2100), g);
  assert.equal(E.computeStats(E.finishGame(g)).ranking[0].correct, 1);
});

test('solitario no extiende el reloj al repetir ni recargar; respuesta tardía cuenta como timeout', () => {
  let g = game('solo');
  assert.equal(g.round.answerDeadline, 31000);
  g = E.markPlaying(E.nextStep(E.markSnippetEnded(g)), 10000);
  assert.equal(g.round.answerDeadline, 31000);
  g = E.restoreGame(parseGame(JSON.parse(JSON.stringify(g)))!);
  assert.equal(g.round.answerDeadline, 31000);
  g = E.submitSoloAnswer(g, 'Música Ligera', 31000);
  assert.equal(g.phase, 'revealed');
  assert.equal(g.players[0].score, -1);
  assert.ok(g.round.events.some((e) => e.kind === 'timeout'));
  g = E.markPlaying(E.nextTrack(g), 50000);
  assert.equal(g.round.answerDeadline, 80000);
});

test('solitario incorrecto y autoevaluación sin reloj', () => {
  let g = E.submitSoloAnswer(game('solo'), 'Otra canción', 2000);
  assert.equal(g.phase, 'revealed'); assert.equal(g.players[0].score, -1);
  g = E.markPlaying({ ...game('solo'), soloAnswer: 'self' }, 2000);
  assert.equal(g.round.answerDeadline, undefined);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'a', at: 2200 }));
  g = E.judgeWrong(E.checkAnswer(g));
  assert.equal(g.phase, 'revealed');
});
