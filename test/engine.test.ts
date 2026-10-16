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
  // Orden fijo: estas pruebas miran reglas de puntaje, no la mezcla.
  g = { ...g, tracks: [track(1), track(2)], settings: { ...g.settings, shuffleOnStart: false } };
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

test('ya no existe el tarareo: tararear y acertar es Correcto', () => {
  assert.equal((E as Record<string, unknown>).judgeHum, undefined);
  assert.equal('pointsHum' in E.newGame().settings, false);
});

test('un tarareo de una partida guardada vieja cuenta como fallo en las estadísticas', () => {
  let g = E.markPlaying(setup(), 0);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'c', at: 5 }));
  g = E.judgeWrong(g);
  g = { ...g, round: { ...g.round, events: g.round.events.map((e) => (e.kind === 'wrong' ? { ...e, kind: 'hum' as const } : e)) } };
  const st = E.computeStats(E.finishGame(g));
  assert.equal(st.ranking.find((p) => p.id === 'c')?.wrong, 1);
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

// ---------- Regresión A02: restaurar una partida guardada ----------

/** Lleva una partida a cada fase con puntajes no triviales. */
function inPhase(phase: 'ready' | 'playing' | 'open' | 'buzzed' | 'revealed') {
  let g = E.markPlaying(setup(), 1000);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'b', at: 1100 }));
  g = E.judgeWrong(g); // Beto -1, bloqueado
  if (phase === 'open') return g;
  if (phase === 'playing') return E.receiveBuzz(E.markPlaying(g, 2000), { playerId: 'a', at: 2100 });
  if (phase === 'buzzed') return E.resolveBuzzes(E.receiveBuzz(E.markPlaying(g), { playerId: 'a', at: 1 }));
  if (phase === 'revealed') return E.reveal(g);
  return E.nextTrack(E.reveal(g)); // ready, tema 2
}

for (const phase of ['ready', 'playing', 'open', 'buzzed', 'revealed'] as const) {
  test(`A02: restaurar en "${phase}" conserva puntajes y deja la partida operable`, () => {
    const saved = inPhase(phase);
    assert.equal(saved.phase, phase);
    const g = E.restoreGame(JSON.parse(JSON.stringify(saved)));
    assert.deepEqual(g.players.map((p) => p.score), saved.players.map((p) => p.score));
    assert.deepEqual(g.round.lockedPlayerIds, saved.round.lockedPlayerIds);
    assert.equal(g.round.pending.length, 0, 'las pulsaciones en espera no sobreviven a la recarga');
    assert.notEqual(g.phase, 'playing', 'nada está sonando después de recargar');
    if (phase === 'playing') {
      assert.equal(g.phase, 'open');
      assert.match(g.notice ?? '', /interrumpió/);
      // Se puede repetir el fragmento.
      assert.equal(E.markPlaying(g).phase, 'playing');
    } else {
      assert.equal(g.phase, phase);
    }
    if (phase === 'buzzed') assert.equal(E.judgeCorrect(g).players[0].score, 1);
  });
}

test('A02: "buzzed" sin jugador con la palabra vuelve a pulsadores abiertos', () => {
  const g = E.restoreGame({ ...inPhase('buzzed'), round: { ...inPhase('buzzed').round, buzzedPlayerId: undefined } });
  assert.equal(g.phase, 'open');
});

// ---------- Regresión A06: terminar antes conserva la ronda actual ----------

test('A06: terminar tras acertar el tema 1 de 2 registra 1 acierto y 1 tema', () => {
  let g = E.markPlaying(setup(), 0);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'a', at: 300 }));
  g = E.judgeCorrect(g);
  g = E.finishGame(g);
  assert.equal(g.phase, 'finished');
  assert.equal(g.history.length, 1);
  const st = E.computeStats(g);
  assert.equal(st.ranking.find((p) => p.id === 'a')?.correct, 1);
  assert.equal(st.fastest?.player.id, 'a');
  assert.ok(E.awards(g).some((a) => a.sub === 'de 1 temas'));
});

test('A06: terminar a mitad de un tema conserva sus fallos y lo marca sin terminar', () => {
  let g = E.markPlaying(setup(), 0);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'b', at: 100 }));
  g = E.judgeWrong(g);
  g = E.finishGame(g);
  assert.equal(g.history.length, 1);
  assert.equal(g.history[0].abandoned, true);
  const st = E.computeStats(g);
  assert.equal(st.ranking.find((p) => p.id === 'b')?.wrong, 1);
  assert.equal(st.unsolved, 0, 'un tema abandonado no cuenta como "nadie la sacó"');
});

test('A06: terminar con alguien con la palabra no deja la palabra colgada', () => {
  let g = E.markPlaying(setup(), 0);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'b', at: 100 }));
  g = E.finishGame(g);
  assert.equal(g.history[0].buzzedPlayerId, undefined);
});

test('A06: terminar en un tema que no sonó no inventa rondas', () => {
  let g = E.markPlaying(setup(), 0);
  g = E.nextTrack(E.reveal(g));
  assert.equal(g.phase, 'ready');
  g = E.finishGame(g);
  assert.equal(g.history.length, 1);
});

test('A06: terminar dos veces o después del último tema no duplica', () => {
  let g = E.nextTrack(E.reveal(E.markPlaying(setup(), 0)));
  g = E.nextTrack(E.reveal(E.markPlaying(g, 0)));
  assert.equal(g.phase, 'finished');
  assert.equal(g.history.length, 2);
  assert.equal(E.finishGame(g).history.length, 2);
  let h = E.finishGame(E.judgeCorrect(E.resolveBuzzes(E.receiveBuzz(E.markPlaying(setup(), 0), { playerId: 'a', at: 1 }))));
  h = E.finishGame(h);
  assert.equal(h.history.length, 1);
});

// ---------- Regresión A08: un único criterio de ganador ----------

function finishedWith(order: string[], plays: Array<[string, 'correct' | 'wrong']>) {
  let g = E.newGame();
  for (const n of order) g = E.addPlayer(g, n, n.toLowerCase());
  g = E.startGame({ ...g, tracks: plays.map((_, i) => track(i)) });
  for (const [pid, verdict] of plays) {
    g = E.resolveBuzzes(E.receiveBuzz(E.markPlaying(g, 0), { playerId: pid, at: 10 }));
    g = verdict === 'correct' ? E.judgeCorrect(g) : E.reveal(E.judgeWrong(g));
    g = E.nextTrack(g);
  }
  return g.phase === 'finished' ? g : E.finishGame(g);
}

test('A08: empate en puntos y aciertos se comparte, sin desempatar por nombre', () => {
  const g = finishedWith(['Beto', 'Ana'], [['beto', 'correct'], ['ana', 'correct']]);
  const st = E.computeStats(g);
  assert.deepEqual([...st.winnerIds].sort(), ['ana', 'beto']);
  assert.deepEqual(st.ranking.map((p) => p.position), [1, 1]);
  const pub = E.toPublic(g);
  assert.deepEqual([...(pub.final?.winnerIds ?? [])].sort(), ['ana', 'beto']);
  assert.deepEqual(pub.final?.ranking.map((r) => r.position), [1, 1]);
});

test('A08: a igual puntaje gana quien tiene más aciertos', () => {
  // Beto: +1 +1 -1 = 1 con 2 aciertos; Ana: +1 = 1 con 1 acierto.
  const g = finishedWith(['Ana', 'Beto'], [['beto', 'correct'], ['beto', 'correct'], ['beto', 'wrong'], ['ana', 'correct']]);
  const st = E.computeStats(g);
  assert.deepEqual(st.winnerIds, ['beto']);
  assert.deepEqual(st.ranking.map((p) => [p.id, p.position]), [['beto', 1], ['ana', 2]]);
});

test('A08: puntajes en cero y negativos', () => {
  const ceros = finishedWith(['Ana', 'Beto'], []);
  assert.deepEqual([...E.computeStats(ceros).winnerIds].sort(), ['ana', 'beto']);
  const neg = finishedWith(['Ana', 'Beto', 'Cami'], [['beto', 'wrong'], ['cami', 'wrong'], ['cami', 'wrong']]);
  const st = E.computeStats(neg);
  assert.deepEqual(st.winnerIds, ['ana']);
  assert.deepEqual(st.ranking.map((p) => [p.id, p.score, p.position]), [['ana', 0, 1], ['beto', -1, 2], ['cami', -2, 3]]);
  assert.deepEqual(E.toPublic(neg).final?.winnerIds, ['ana']);
});

// ---------- Regresión B09: reincorporar a un jugador con otra conexión ----------

test('B09: reassignPlayer conserva puntaje, bloqueos e historial con el id nuevo', () => {
  let g = E.markPlaying(setup(), 0);
  g = E.resolveBuzzes(E.receiveBuzz(g, { playerId: 'a', at: 10 }));
  g = E.nextTrack(E.judgeCorrect(g)); // Ana +1 en el historial
  g = E.resolveBuzzes(E.receiveBuzz(E.markPlaying(g, 0), { playerId: 'a', at: 10 }));
  g = E.judgeWrong(g); // Ana -1 y bloqueada en el tema actual
  const r = E.reassignPlayer(g, 'a', 'abcdef123456');
  const ana = r.players.find((p) => p.name === 'Ana')!;
  assert.equal(ana.id, 'abcdef123456');
  assert.equal(ana.score, 0);
  assert.equal(ana.remote, true);
  assert.deepEqual(r.round.lockedPlayerIds, ['abcdef123456']);
  assert.equal(r.history[0].solvedBy, 'abcdef123456');
  assert.ok(!JSON.stringify(r).includes('"a"'), 'no queda rastro del id viejo');
  assert.equal(E.canBuzz(r, 'abcdef123456'), false, 'sigue bloqueada en este tema');
  const st = E.computeStats(E.finishGame(r));
  assert.equal(st.ranking.find((p) => p.id === 'abcdef123456')?.correct, 1);
});

test('B09: reassignPlayer no pisa a otro jugador ni acepta ids inexistentes', () => {
  const g = setup();
  assert.equal(E.reassignPlayer(g, 'a', 'b'), g);
  assert.equal(E.reassignPlayer(g, 'zz', 'nuevo'), g);
});

test('isRemotePlayer reconoce celulares en partidas guardadas viejas', () => {
  assert.equal(E.isRemotePlayer({ id: 'abcdef123456', name: 'x', color: '', score: 0, connected: true }), true);
  assert.equal(E.isRemotePlayer({ id: 'k3j2h1lmn0', name: 'x', color: '', score: 0, connected: true }), false);
  assert.equal(E.addPlayer(E.newGame(), 'Ana', 'abcdef123456', true).players[0].remote, true);
});

test('al empezar, la lista se mezcla (opción activada de entrada) sin perder ni repetir temas', () => {
  const tracks = [1, 2, 3, 4, 5, 6].map(track);
  const base = { ...E.addPlayer(E.newGame(), 'Ana', 'a'), tracks };
  assert.equal(base.settings.shuffleOnStart, true);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = E.startGame(base, rand);
  assert.notDeepEqual(g.tracks.map((t) => t.id), tracks.map((t) => t.id));
  assert.deepEqual(g.tracks.map((t) => t.id).sort(), tracks.map((t) => t.id).sort());
  assert.equal(g.round.trackIndex, 0);
});

test('con la opción apagada se respeta el orden de la lista', () => {
  const tracks = [1, 2, 3, 4].map(track);
  const g = E.startGame({ ...E.addPlayer(E.newGame(), 'Ana', 'a'), tracks, settings: { ...E.newGame().settings, shuffleOnStart: false } }, () => 0);
  assert.deepEqual(g.tracks.map((t) => t.id), ['t1', 't2', 't3', 't4']);
});
