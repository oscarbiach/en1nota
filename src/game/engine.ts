// Motor de reglas: funciones puras sobre GameState. Sin red, sin audio.
import type { Buzz, GameState, Player, PublicState, Round, RoundEvent, Settings, Track } from './types.ts';
import { DEFAULT_SETTINGS, PLAYER_COLORS } from './types.ts';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function newRound(trackIndex: number): Round {
  return { trackIndex, step: 0, lockedPlayerIds: [], pending: [], events: [] };
}

export function newGame(partial: Partial<GameState> = {}): GameState {
  return {
    id: newId(),
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
  return g.phase === 'playing' || g.phase === 'open';
}

export function canBuzz(g: GameState, playerId: string): boolean {
  if (!buzzersOpen(g)) return false;
  if (g.round.lockedPlayerIds.includes(playerId)) return false;
  return g.players.some((p) => p.id === playerId);
}

// ---------- jugadores ----------

export function addPlayer(g: GameState, name: string, id = newId()): GameState {
  const clean = name.trim().slice(0, 24) || `Jugador ${g.players.length + 1}`;
  const used = new Set(g.players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[g.players.length % PLAYER_COLORS.length];
  const player: Player = { id, name: clean, color, score: 0, connected: true, key: String(g.players.length + 1) };
  return { ...g, players: [...g.players, player] };
}

export function removePlayer(g: GameState, id: string): GameState {
  return { ...g, players: g.players.filter((p) => p.id !== id).map((p, i) => ({ ...p, key: String(i + 1) })) };
}

export function renamePlayer(g: GameState, id: string, name: string): GameState {
  return { ...g, players: g.players.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 24) || p.name } : p)) };
}

export function setConnected(g: GameState, id: string, connected: boolean): GameState {
  return { ...g, players: g.players.map((p) => (p.id === id ? { ...p, connected } : p)) };
}

export function adjustScore(g: GameState, id: string, delta: number): GameState {
  return { ...g, players: g.players.map((p) => (p.id === id ? { ...p, score: p.score + delta } : p)) };
}

// ---------- flujo de partida ----------

export function startGame(g: GameState): GameState {
  if (g.tracks.length === 0) return g;
  return {
    ...g,
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
  if (!['ready', 'open', 'playing'].includes(g.phase)) return g;
  const ev: RoundEvent = { kind: 'replay', step: g.round.step, at };
  return {
    ...g,
    phase: 'playing',
    notice: undefined,
    round: { ...g.round, playStartedAt: at, pending: [], events: g.round.step === 0 && g.round.events.length === 0 ? g.round.events : [...g.round.events, ev] }
  };
}

/** El fragmento terminó de sonar: siguen abiertos los pulsadores. */
export function markSnippetEnded(g: GameState): GameState {
  return g.phase === 'playing' ? { ...g, phase: 'open' } : g;
}

/** Una pulsación llega al host. Entra en la ventana de empate. */
export function receiveBuzz(g: GameState, buzz: Buzz): GameState {
  if (!canBuzz(g, buzz.playerId)) return g;
  if (g.round.pending.some((b) => b.playerId === buzz.playerId)) return g;
  return { ...g, round: { ...g.round, pending: [...g.round.pending, buzz] } };
}

/** Cierra la ventana de empate: el más rápido tiene la palabra. */
export function resolveBuzzes(g: GameState, now = Date.now()): GameState {
  if (!buzzersOpen(g) || g.round.pending.length === 0) return g;
  const winner = [...g.round.pending].sort((a, b) => a.at - b.at)[0];
  const reactionMs = g.round.playStartedAt !== undefined ? Math.max(0, winner.at - g.round.playStartedAt) : undefined;
  const ev: RoundEvent = { kind: 'buzz', playerId: winner.playerId, step: g.round.step, at: now, reactionMs };
  return {
    ...g,
    phase: 'buzzed',
    round: { ...g.round, buzzedPlayerId: winner.playerId, pending: [], events: [...g.round.events, ev] }
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
    round: { ...g.round, buzzedPlayerId: undefined, solvedBy: pid, events: [...g.round.events, { ...ev, kind: 'correct' }, { kind: 'reveal', step: g.round.step, at }] }
  };
}

function fail(g: GameState, kind: 'wrong' | 'hum' | 'timeout', at: number): GameState {
  const pid = g.round.buzzedPlayerId;
  if (g.phase !== 'buzzed' || !pid) return g;
  const points = kind === 'hum' ? g.settings.pointsHum : g.settings.pointsWrong;
  const ev: RoundEvent = { kind, playerId: pid, step: g.round.step, points, at };
  const next = adjustScore(g, pid, points);
  const name = g.players.find((p) => p.id === pid)?.name ?? '';
  const locked = g.settings.lockOnFail ? [...g.round.lockedPlayerIds, pid] : g.round.lockedPlayerIds;
  const label = kind === 'hum' ? 'tarareó' : kind === 'timeout' ? 'se quedó en blanco' : 'falló';
  return {
    ...next,
    phase: 'open',
    notice: `${name} ${label} (${points})`,
    round: { ...g.round, buzzedPlayerId: undefined, lockedPlayerIds: locked, events: [...g.round.events, ev] }
  };
}

export const judgeWrong = (g: GameState, at = Date.now()) => fail(g, 'wrong', at);
export const judgeHum = (g: GameState, at = Date.now()) => fail(g, 'hum', at);
export const judgeTimeout = (g: GameState, at = Date.now()) => fail(g, 'timeout', at);

/** El juez decide pasar a un fragmento más largo. */
export function nextStep(g: GameState): GameState {
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
    round: { ...g.round, buzzedPlayerId: undefined, pending: [], events: [...g.round.events, { kind: 'reveal', step: g.round.step, at }] }
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
  return nextTrack({ ...g, phase: 'revealed' });
}

export function jumpToTrack(g: GameState, index: number): GameState {
  if (index < 0 || index >= g.tracks.length) return g;
  return { ...g, phase: 'ready', round: newRound(index), notice: undefined };
}

export function finishGame(g: GameState): GameState {
  return { ...g, phase: 'finished', finishedAt: Date.now() };
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
    solvedBy: g.round.solvedBy,
    revealed,
    notice: g.notice,
    lastEvent,
    finished: g.phase === 'finished',
    awards: g.phase === 'finished' ? awards(g) : undefined
  };
}

export function awards(g: GameState): Array<{ k: string; v: string; sub: string }> {
  const st = computeStats(g);
  const out: Array<{ k: string; v: string; sub: string }> = [];
  if (st.fastest) out.push({ k: '⚡ Reflejo', v: st.fastest.player.name, sub: `acertó a los ${(st.fastest.reactionMs / 1000).toFixed(2)} s` });
  if (st.mostImpulsive) out.push({ k: '🤦 Impulsivo', v: st.mostImpulsive.name, sub: `${st.mostImpulsive.wrong + st.mostImpulsive.hums} fallos` });
  if (st.mostHums) out.push({ k: '🎤 Tarareador', v: st.mostHums.name, sub: `${st.mostHums.hums} tarareos` });
  if (st.mostNegative) out.push({ k: '📉 Bajo cero', v: st.mostNegative.name, sub: `terminó con ${st.mostNegative.score}` });
  out.push({ k: '🙈 Nadie la sacó', v: String(st.unsolved), sub: `de ${g.history.length} temas` });
  return out;
}

// ---------- estadísticas ----------

export type RankedPlayer = Player & { correct: number; wrong: number; hums: number; buzzes: number; bestReactionMs?: number };

export interface Stats {
  ranking: RankedPlayer[];
  fastest?: { player: Player; reactionMs: number; trackIndex: number };
  mostNegative?: RankedPlayer;
  mostHums?: RankedPlayer;
  mostImpulsive?: RankedPlayer;
  unsolved: number;
}

export function computeStats(g: GameState): Stats {
  const rounds = g.phase === 'finished' ? g.history : [...g.history, g.round];
  const per = new Map(g.players.map((p) => [p.id, { correct: 0, wrong: 0, hums: 0, buzzes: 0, best: undefined as number | undefined }]));
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
      if (e.kind === 'wrong' || e.kind === 'timeout') s.wrong++;
      if (e.kind === 'hum') s.hums++;
    }
  }
  const ranking = g.players
    .map((p) => {
      const s = per.get(p.id)!;
      return { ...p, correct: s.correct, wrong: s.wrong, hums: s.hums, buzzes: s.buzzes, bestReactionMs: s.best };
    })
    .sort((a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name));
  const withScore = ranking.filter((p) => p.buzzes > 0);
  const mostNegative = ranking.length && ranking[ranking.length - 1].score < 0 ? ranking[ranking.length - 1] : undefined;
  const mostHums = [...withScore].sort((a, b) => b.hums - a.hums)[0];
  const mostImpulsive = [...withScore].sort((a, b) => b.wrong + b.hums - (a.wrong + a.hums))[0];
  return {
    ranking,
    fastest,
    mostNegative,
    mostHums: mostHums && mostHums.hums > 0 ? mostHums : undefined,
    mostImpulsive: mostImpulsive && mostImpulsive.wrong + mostImpulsive.hums > 0 ? mostImpulsive : undefined,
    unsolved
  };
}
