// Motor de reglas: funciones puras sobre GameState. Sin red, sin audio.
import type { Buzz, FinalResult, GameState, Player, PublicState, Round, RoundEvent, Settings, Track } from './types.ts';
import { DEFAULT_SETTINGS, PLAYER_COLORS } from './types.ts';
import { shuffle } from '../util/format.ts';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function newRound(trackIndex: number): Round {
  return { trackIndex, step: 0, lockedPlayerIds: [], pending: [], queue: [], events: [] };
}

export function newGame(partial: Partial<GameState> = {}): GameState {
  return {
    id: newId(),
    mode: 'party',
    createdAt: Date.now(),
    players: [],
    tracks: [],
    settings: { ...DEFAULT_SETTINGS },
    phase: 'lobby',
    round: newRound(0),
    history: [],
    ...partial
  };
}

export function stepMs(settings: Settings, step: number): number {
  const s = settings.steps;
  return s[Math.min(step, s.length - 1)] ?? 1000;
}

export function pointsFor(settings: Settings, step: number): number {
  const p = settings.pointsCorrect;
  return p[Math.min(step, p.length - 1)] ?? 1;
}

export function currentTrack(g: GameState): Track | undefined {
  return g.tracks[g.round.trackIndex];
}

export function buzzersOpen(g: GameState): boolean {
  return g.phase === 'playing' || g.phase === 'open' || g.phase === 'buzzed';
}

export function canBuzz(g: GameState, playerId: string): boolean {
  if (isSoloWritten(g)) return false;
  if (!buzzersOpen(g)) return false;
  if (g.round.answerShown) return false;
  if (g.round.lockedPlayerIds.includes(playerId)) return false;
  if (g.round.buzzedPlayerId === playerId || [...g.round.pending, ...(g.round.queue ?? [])].some((b) => b.playerId === playerId)) return false;
  return g.players.some((p) => p.id === playerId);
}

// ---------- jugadores ----------

/** Los nombres pueden venir de la red: cualquier cosa que no sea texto cuenta como vacío. */
function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, 24) : '';
}

export function addPlayer(g: GameState, name: string, id = newId(), remote = false): GameState {
  if (g.players.length >= playerLimit(g) || g.players.some((p) => p.id === id)) return g;
  const clean = cleanName(name) || `Jugador ${g.players.length + 1}`;
  const used = new Set(g.players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[g.players.length % PLAYER_COLORS.length];
  const player: Player = { id, name: clean, color, score: 0, connected: true, key: String(g.players.length + 1), ...(remote ? { remote } : {}) };
  return { ...g, players: [...g.players, player] };
}

/** Jugador con celular. Partidas guardadas antes de `remote`: los pid del servidor son 12 hex. */
export function isRemotePlayer(p: Player): boolean {
  return p.remote ?? /^[a-f0-9]{12}$/.test(p.id);
}

/**
 * Pasa el puesto de un jugador a otra conexión (B09): el juez confirmó que
 * quien entró con `toId` es el mismo `fromId`, p. ej. tras un reinicio del
 * servidor o si su celular perdió la sesión. Conserva puntaje, color,
 * bloqueos e historial; sólo cambia el identificador en toda la partida.
 */
export function reassignPlayer(g: GameState, fromId: string, toId: string): GameState {
  if (fromId === toId || !g.players.some((p) => p.id === fromId) || g.players.some((p) => p.id === toId)) return g;
  const id = (x: string | undefined) => (x === fromId ? toId : x);
  const round = (r: Round): Round => ({
    ...r,
    lockedPlayerIds: r.lockedPlayerIds.map((x) => id(x)!),
    buzzedPlayerId: id(r.buzzedPlayerId),
    solvedBy: id(r.solvedBy),
    pending: r.pending.map((b) => ({ ...b, playerId: id(b.playerId)! })),
    queue: r.queue?.map((b) => ({ ...b, playerId: id(b.playerId)! })),
    events: r.events.map((e) => (e.playerId === fromId ? { ...e, playerId: toId } : e))
  });
  return {
    ...g,
    players: g.players.map((p) => (p.id === fromId ? { ...p, id: toId, connected: true, remote: true } : p)),
    round: round(g.round),
    history: g.history.map(round)
  };
}

export function removePlayer(g: GameState, id: string): GameState {
  const next = { ...g, players: g.players.filter((p) => p.id !== id).map((p, i) => ({ ...p, key: String(i + 1) })),
    round: { ...g.round, pending: g.round.pending.filter((b) => b.playerId !== id), queue: (g.round.queue ?? []).filter((b) => b.playerId !== id) } };
  return g.round.buzzedPlayerId === id
    ? resolveBuzzes({ ...next, phase: 'open', round: { ...next.round, buzzedPlayerId: undefined } }) : next;
}

export function playerLimit(g: Pick<GameState, 'mode'>): number {
  return g.mode === 'solo' ? 1 : g.mode === 'duel' ? 2 : 8;
}

export function validPlayerCount(g: GameState): boolean {
  return g.players.length > 0 && g.players.length <= playerLimit(g) && (g.mode !== 'duel' || g.players.length === 2);
}

export const isSoloWritten = (g: GameState) => g.mode === 'solo' && g.soloAnswer !== 'self';

export function renamePlayer(g: GameState, id: string, name: string): GameState {
  return { ...g, players: g.players.map((p) => (p.id === id ? { ...p, name: cleanName(name) || p.name } : p)) };
}

export function setConnected(g: GameState, id: string, connected: boolean): GameState {
  return { ...g, players: g.players.map((p) => (p.id === id ? { ...p, connected } : p)) };
}

export function adjustScore(g: GameState, id: string, delta: number): GameState {
  return { ...g, players: g.players.map((p) => (p.id === id ? { ...p, score: p.score + delta } : p)) };
}

// ---------- flujo de partida ----------

export function startGame(g: GameState, rand = Math.random): GameState {
  if (g.tracks.length === 0 || !validPlayerCount(g)) return g;
  return {
    ...g,
    tracks: g.settings.shuffleOnStart ? shuffle(g.tracks, rand) : g.tracks,
    createdAt: Date.now(),
    phase: 'ready',
    round: newRound(0),
    history: [],
    players: g.players.map((p) => ({ ...p, score: 0 })),
    notice: undefined
  };
}

/** El juez apretó "reproducir": arranca (o repite) la pasada actual. */
export function markPlaying(g: GameState, at = Date.now()): GameState {
  if (g.round.pending.length) return g;
  if (!['ready', 'open', 'playing'].includes(g.phase)) return g;
  const ev: RoundEvent = { kind: 'replay', step: g.round.step, at };
  return {
    ...g,
    phase: 'playing',
    notice: undefined,
    round: { ...g.round, playStartedAt: at, answerDeadline: isSoloWritten(g) ? g.round.answerDeadline ?? at + 30_000 : undefined,
      pending: [], events: g.round.step === 0 && g.round.events.length === 0 ? g.round.events : [...g.round.events, ev] }
  };
}

/**
 * Partida leída de localStorage tras una recarga (o actualización de la PWA).
 * Los timers de la página anterior ya no existen: nada está sonando y no hay
 * ventana de empate abierta. Normaliza las fases transitorias a una fase
 * segura sin tocar puntajes, bloqueos ni historial.
 */
export function restoreGame(g: GameState): GameState {
  const seen = new Set([g.round.buzzedPlayerId, ...g.round.lockedPlayerIds]);
  const queue = (g.round.queue ?? []).filter((b) => {
    if (seen.has(b.playerId) || !g.players.some((p) => p.id === b.playerId)) return false;
    seen.add(b.playerId); return true;
  });
  const round = { ...g.round, queue, pending: [] };
  if (g.phase === 'playing') {
    return { ...g, phase: 'open', notice: 'Se interrumpió el fragmento: podés repetirlo.', round };
  }
  if (g.phase === 'buzzed' && !round.buzzedPlayerId) {
    return { ...g, phase: 'open', round };
  }
  return { ...g, round };
}

/** El fragmento terminó de sonar: siguen abiertos los pulsadores. */
export function markSnippetEnded(g: GameState): GameState {
  return g.phase === 'playing' ? { ...g, phase: 'open' } : g;
}

/** Una pulsación llega al host. Entra en la ventana de empate. */
export function receiveBuzz(g: GameState, buzz: Buzz): GameState {
  if (!canBuzz(g, buzz.playerId)) return g;
  if (g.round.pending.some((b) => b.playerId === buzz.playerId)) return g;
  if (g.phase === 'buzzed') return { ...g, round: { ...g.round, queue: [...(g.round.queue ?? []), buzz].sort((a, b) => a.at - b.at) } };
  return { ...g, round: { ...g.round, pending: [...g.round.pending, buzz] } };
}

/** Cierra la ventana de empate: el más rápido tiene la palabra. */
export function resolveBuzzes(g: GameState, now = Date.now()): GameState {
  if (!buzzersOpen(g) || g.round.buzzedPlayerId) return g;
  const [winner, ...queue] = [...(g.round.queue ?? []), ...g.round.pending]
    .filter((b) => g.players.some((p) => p.id === b.playerId) && !g.round.lockedPlayerIds.includes(b.playerId))
    .sort((a, b) => a.at - b.at);
  if (!winner) return g;
  const reactionMs = g.round.playStartedAt !== undefined ? Math.max(0, winner.at - g.round.playStartedAt) : undefined;
  const ev: RoundEvent = { kind: 'buzz', playerId: winner.playerId, step: g.round.step, at: now, reactionMs };
  return {
    ...g,
    phase: 'buzzed',
    round: { ...g.round, buzzedPlayerId: winner.playerId, pending: [], queue, events: [...g.round.events, ev] }
  };
}

export function judgeCorrect(g: GameState, at = Date.now()): GameState {
  const pid = g.round.buzzedPlayerId;
  if (g.phase !== 'buzzed' || !pid) return g;
  const points = pointsFor(g.settings, g.round.step);
  const ev: RoundEvent = { kind: 'correct', playerId: pid, step: g.round.step, points, at };
  const next = adjustScore(g, pid, points);
  const name = g.players.find((p) => p.id === pid)?.name ?? '';
  return {
    ...next,
    phase: 'revealed',
    notice: `¡${name} acertó! +${points}`,
    round: { ...g.round, buzzedPlayerId: undefined, pending: [], queue: [], solvedBy: pid, events: [...g.round.events, { ...ev, kind: 'correct' }, { kind: 'reveal', step: g.round.step, at }] }
  };
}

/** Las respuestas se comprometen antes de consultar el título, sin juez extra. */
export function checkAnswer(g: GameState): GameState {
  if (g.mode !== 'solo' && g.mode !== 'duel' || g.phase !== 'buzzed') return g;
  return { ...g, round: { ...g.round, answerShown: true } };
}

/** Comparación deliberadamente estricta: no exige tildes, signos ni mayúsculas. */
export function matchesTitle(answer: string, title: string): boolean {
  const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const a = normalize(answer);
  return a.length > 0 && a === normalize(title);
}

export function submitSoloAnswer(g: GameState, answer: string, at = Date.now()): GameState {
  if (!isSoloWritten(g) || !['playing', 'open'].includes(g.phase) || !g.players[0] || g.round.answerDeadline === undefined) return g;
  const expired = at >= g.round.answerDeadline;
  if (!expired && !answer.trim()) return g;
  const floor = resolveBuzzes({ ...g, round: { ...g.round, pending: [{ playerId: g.players[0].id, at }] } }, at);
  const checked = checkAnswer(floor);
  return expired ? judgeTimeout(checked, at)
    : matchesTitle(answer, currentTrack(g)?.name ?? '') ? judgeCorrect(checked, at) : judgeWrong(checked, at);
}

function fail(g: GameState, kind: 'wrong' | 'timeout', at: number): GameState {
  const pid = g.round.buzzedPlayerId;
  if (g.phase !== 'buzzed' || !pid) return g;
  const points = g.settings.pointsWrong;
  const ev: RoundEvent = { kind, playerId: pid, step: g.round.step, points, at };
  const next = adjustScore(g, pid, points);
  const name = g.players.find((p) => p.id === pid)?.name ?? '';
  const locked = g.settings.lockOnFail ? [...g.round.lockedPlayerIds, pid] : g.round.lockedPlayerIds;
  const label = kind === 'timeout' ? 'se quedó en blanco' : 'falló';
  const result = resolveBuzzes({
    ...next,
    phase: 'open',
    notice: `${name} ${label} (${points})`,
    round: { ...g.round, buzzedPlayerId: undefined, lockedPlayerIds: locked, events: [...g.round.events, ev] }
  }, at);
  // Después de mirar el título no hay nuevos intentos en autoevaluación.
  return result.round.answerShown && result.phase === 'open' ? { ...reveal(result, at), notice: result.notice } : result;
}

export const judgeWrong = (g: GameState, at = Date.now()) => fail(g, 'wrong', at);
export const judgeTimeout = (g: GameState, at = Date.now()) => fail(g, 'timeout', at);

/** El juez decide pasar a un fragmento más largo. */
export function nextStep(g: GameState): GameState {
  if (g.round.pending.length) return g;
  if (!['open', 'ready', 'playing'].includes(g.phase)) return g;
  const max = g.settings.steps.length - 1;
  return { ...g, phase: 'open', round: { ...g.round, step: Math.min(max, g.round.step + 1), pending: [] } };
}

export function hasMoreSteps(g: GameState): boolean {
  return g.round.step < g.settings.steps.length - 1;
}

/** Nadie acertó: se revela sin puntos. */
export function reveal(g: GameState, at = Date.now()): GameState {
  if (!['ready', 'playing', 'open', 'buzzed'].includes(g.phase)) return g;
  return {
    ...g,
    phase: 'revealed',
    notice: 'Nadie la sacó',
    round: { ...g.round, buzzedPlayerId: undefined, pending: [], queue: [], events: [...g.round.events, { kind: 'reveal', step: g.round.step, at }] }
  };
}

export function nextTrack(g: GameState): GameState {
  if (g.phase !== 'revealed') return g;
  const history = [...g.history, g.round];
  const idx = g.round.trackIndex + 1;
  if (idx >= g.tracks.length) {
    return { ...g, phase: 'finished', finishedAt: Date.now(), history, notice: undefined };
  }
  return { ...g, phase: 'ready', round: newRound(idx), history, notice: undefined };
}

/** Saltar un tema sin jugarlo (o abandonar el actual). */
export function skipTrack(g: GameState): GameState {
  if (['lobby', 'finished'].includes(g.phase)) return g;
  return nextTrack({ ...g, phase: 'revealed', round: { ...g.round, pending: [], queue: [], buzzedPlayerId: undefined } });
}

export function jumpToTrack(g: GameState, index: number): GameState {
  if (index < 0 || index >= g.tracks.length) return g;
  return { ...g, phase: 'ready', round: newRound(index), notice: undefined };
}

/**
 * El juez termina la partida antes del último tema. La ronda en curso entra
 * al historial una sola vez si tuvo actividad (sonó, alguien tocó, se
 * reveló): los puntos que ya cambió tienen que verse en las estadísticas.
 * Si no estaba revelada queda marcada como abandonada. Un tema que no llegó
 * a sonar no se registra.
 */
export function finishGame(g: GameState): GameState {
  if (g.phase === 'finished') return g;
  const r = g.round;
  const played = g.phase !== 'lobby' && (r.events.length > 0 || g.phase === 'revealed');
  const closed = played
    ? { ...r, pending: [], queue: [], buzzedPlayerId: undefined, ...(g.phase === 'revealed' ? {} : { abandoned: true }) }
    : undefined;
  return {
    ...g,
    phase: 'finished',
    finishedAt: Date.now(),
    notice: undefined,
    round: closed ?? { ...r, pending: [], queue: [], buzzedPlayerId: undefined },
    history: closed ? [...g.history, closed] : g.history
  };
}

// ---------- vista pública ----------

export function toPublic(g: GameState): PublicState {
  const t = currentTrack(g);
  const revealed = g.phase === 'revealed' && t ? { name: t.name, artists: t.artists, album: t.album, image: t.image } : undefined;
  const lastEvent = g.round.events[g.round.events.length - 1];
  return {
    phase: g.phase,
    players: g.players.map(({ id, name, color, score, connected }) => ({ id, name, color, score, connected })),
    trackIndex: g.round.trackIndex,
    trackCount: g.tracks.length,
    step: g.round.step,
    stepMs: stepMs(g.settings, g.round.step),
    stepCount: g.settings.steps.length,
    lockedPlayerIds: g.round.lockedPlayerIds,
    buzzedPlayerId: g.round.buzzedPlayerId,
    queuedPlayerIds: [...(g.round.queue ?? []), ...g.round.pending].sort((a, b) => a.at - b.at).map((b) => b.playerId),
    answersClosed: !!g.round.answerShown,
    solvedBy: g.round.solvedBy,
    revealed,
    notice: g.notice,
    lastEvent,
    finished: g.phase === 'finished',
    awards: g.phase === 'finished' ? awards(g) : undefined,
    final: g.phase === 'finished' ? finalResult(g) : undefined
  };
}

/** Resultado final para pantallas que no tienen la partida completa (TV). */
export function finalResult(g: GameState): FinalResult {
  const st = computeStats(g);
  return {
    ranking: st.ranking.map((p) => ({ id: p.id, position: p.position, score: p.score, correct: p.correct })),
    winnerIds: st.winnerIds
  };
}

export function awards(g: GameState): Array<{ k: string; v: string; sub: string }> {
  const st = computeStats(g);
  const out: Array<{ k: string; v: string; sub: string }> = [];
  if (st.fastest) out.push({ k: '⚡ Reflejo', v: st.fastest.player.name, sub: `acertó a los ${(st.fastest.reactionMs / 1000).toFixed(2)} s` });
  if (st.mostImpulsive) out.push({ k: '🤦 Impulsivo', v: st.mostImpulsive.name, sub: `${st.mostImpulsive.wrong} fallos` });
  if (st.mostNegative) out.push({ k: '📉 Bajo cero', v: st.mostNegative.name, sub: `terminó con ${st.mostNegative.score}` });
  out.push({ k: '🙈 Nadie la sacó', v: String(st.unsolved), sub: `de ${g.history.length} temas` });
  return out;
}

// ---------- estadísticas ----------

export type RankedPlayer = Player & { correct: number; wrong: number; buzzes: number; bestReactionMs?: number; position: number };

/**
 * Criterio único de ranking para juez, TV e historial: más puntos, y a igual
 * puntaje más aciertos. Si sigue igual, el puesto se comparte (1, 1, 3) y
 * todos los empatados en el primero son ganadores. No se desempata por
 * nombre ni por orden de llegada. Dentro de un empate se conserva el orden
 * en que entraron los jugadores.
 */
export function rankStandings<T extends { score: number; correct: number }>(players: T[]): Array<T & { position: number }> {
  const better = (a: T, b: T) => b.score - a.score || b.correct - a.correct;
  const sorted = players.map((p, i) => ({ p, i })).sort((x, y) => better(x.p, y.p) || x.i - y.i).map((x) => x.p);
  return sorted.map((p) => ({ ...p, position: 1 + sorted.filter((q) => better(q, p) < 0).length }));
}

export interface Stats {
  ranking: RankedPlayer[];
  /** Todos los que comparten el primer puesto. */
  winnerIds: string[];
  fastest?: { player: Player; reactionMs: number; trackIndex: number };
  mostNegative?: RankedPlayer;
  mostImpulsive?: RankedPlayer;
  unsolved: number;
}

export function computeStats(g: GameState): Stats {
  const rounds = g.phase === 'finished' ? g.history : [...g.history, g.round];
  const per = new Map(g.players.map((p) => [p.id, { correct: 0, wrong: 0, buzzes: 0, best: undefined as number | undefined }]));
  let fastest: Stats['fastest'];
  let unsolved = 0;
  for (const r of rounds) {
    if (!r.solvedBy && r.events.some((e) => e.kind === 'reveal')) unsolved++;
    for (const e of r.events) {
      const s = e.playerId ? per.get(e.playerId) : undefined;
      if (!s) continue;
      if (e.kind === 'buzz') {
        s.buzzes++;
        if (e.reactionMs !== undefined) {
          if (s.best === undefined || e.reactionMs < s.best) s.best = e.reactionMs;
        }
      }
      if (e.kind === 'correct') {
        s.correct++;
        const buzz = [...r.events].reverse().find((b) => b.kind === 'buzz' && b.playerId === e.playerId);
        if (buzz?.reactionMs !== undefined && (!fastest || buzz.reactionMs < fastest.reactionMs)) {
          const player = g.players.find((p) => p.id === e.playerId)!;
          fastest = { player, reactionMs: buzz.reactionMs, trackIndex: r.trackIndex };
        }
      }
      // 'hum' (tarareo) sólo aparece en partidas guardadas antes de quitarlo: cuenta como fallo.
      if (e.kind === 'wrong' || e.kind === 'timeout' || e.kind === 'hum') s.wrong++;
    }
  }
  const ranking = rankStandings(g.players.map((p) => {
    const s = per.get(p.id)!;
    return { ...p, correct: s.correct, wrong: s.wrong, buzzes: s.buzzes, bestReactionMs: s.best };
  }));
  const winnerIds = ranking.filter((p) => p.position === 1).map((p) => p.id);
  const withScore = ranking.filter((p) => p.buzzes > 0);
  const mostNegative = ranking.length && ranking[ranking.length - 1].score < 0 ? ranking[ranking.length - 1] : undefined;
  const mostImpulsive = [...withScore].sort((a, b) => b.wrong - a.wrong)[0];
  return {
    ranking,
    winnerIds,
    fastest,
    mostNegative,
    mostImpulsive: mostImpulsive && mostImpulsive.wrong > 0 ? mostImpulsive : undefined,
    unsolved
  };
}
