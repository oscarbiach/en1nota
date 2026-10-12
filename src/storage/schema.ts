// Validación y migración de lo guardado en localStorage (B06). Lo que se lee
// del almacenamiento es dato externo: puede venir de una versión anterior,
// estar incompleto o dañado. Se repara lo que se puede reconocer con certeza
// y se rechaza el resto, en vez de dejar que la interfaz falle al dibujarlo.
import type { GameState, Phase, Player, Round, RoundEvent, Settings, Track } from '../game/types.ts';
import { DEFAULT_SETTINGS } from '../game/types.ts';

/** Versión del formato guardado. Sin `v` = versión 0 (antes de existir el campo). */
export const SCHEMA_VERSION = 1;

const PHASES: Phase[] = ['lobby', 'ready', 'playing', 'open', 'buzzed', 'revealed', 'finished'];
const EVENT_KINDS = ['buzz', 'correct', 'wrong', 'hum', 'timeout', 'replay', 'reveal'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const optStr = (v: unknown) => (isStr(v) ? v : undefined);
const optNum = (v: unknown) => (isNum(v) ? v : undefined);
const numArr = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(isNum);

export function parseTrack(v: unknown): Track | null {
  if (!isObj(v) || !isStr(v.uri) || !isStr(v.name)) return null;
  return {
    id: isStr(v.id) ? v.id : v.uri,
    uri: v.uri,
    name: v.name,
    artists: isStr(v.artists) ? v.artists : '',
    album: isStr(v.album) ? v.album : '',
    ...(isStr(v.image) ? { image: v.image } : {}),
    durationMs: isNum(v.durationMs) ? v.durationMs : 0,
    startMs: isNum(v.startMs) && v.startMs >= 0 ? v.startMs : 0
  };
}

function parsePlayer(v: unknown): Player | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isStr(v.color) || !isNum(v.score)) return null;
  return {
    id: v.id,
    name: v.name,
    color: v.color,
    score: v.score,
    connected: v.connected === true,
    ...(isStr(v.key) ? { key: v.key } : {}),
    ...(typeof v.remote === 'boolean' ? { remote: v.remote } : {})
  };
}

function parseSettings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  return {
    steps: numArr(s.steps) ? (s.steps as number[]) : DEFAULT_SETTINGS.steps,
    pointsCorrect: numArr(s.pointsCorrect) ? (s.pointsCorrect as number[]) : DEFAULT_SETTINGS.pointsCorrect,
    pointsWrong: isNum(s.pointsWrong) ? s.pointsWrong : DEFAULT_SETTINGS.pointsWrong,
    buzzWindowMs: isNum(s.buzzWindowMs) && s.buzzWindowMs >= 0 ? s.buzzWindowMs : DEFAULT_SETTINGS.buzzWindowMs,
    revealMs: isNum(s.revealMs) && s.revealMs > 0 ? s.revealMs : DEFAULT_SETTINGS.revealMs,
    lockOnFail: typeof s.lockOnFail === 'boolean' ? s.lockOnFail : DEFAULT_SETTINGS.lockOnFail
  };
}

function parseEvent(v: unknown): RoundEvent | null {
  if (!isObj(v) || !EVENT_KINDS.includes(v.kind as string) || !isNum(v.step) || !isNum(v.at)) return null;
  return {
    kind: v.kind as RoundEvent['kind'],
    step: v.step,
    at: v.at,
    ...(isStr(v.playerId) ? { playerId: v.playerId } : {}),
    ...(isNum(v.points) ? { points: v.points } : {}),
    ...(isNum(v.reactionMs) ? { reactionMs: v.reactionMs } : {})
  };
}

function parseRound(v: unknown): Round | null {
  if (!isObj(v) || !isInt(v.trackIndex)) return null;
  const strs = (a: unknown) => (Array.isArray(a) ? a.filter(isStr) : []);
  return {
    trackIndex: v.trackIndex,
    step: isInt(v.step) ? v.step : 0,
    lockedPlayerIds: strs(v.lockedPlayerIds),
    buzzedPlayerId: optStr(v.buzzedPlayerId),
    // Las pulsaciones en espera nunca sobreviven a una recarga.
    pending: [],
    events: Array.isArray(v.events) ? v.events.map(parseEvent).filter((e): e is RoundEvent => !!e) : [],
    solvedBy: optStr(v.solvedBy),
    playStartedAt: optNum(v.playStartedAt),
    ...(v.abandoned === true ? { abandoned: true } : {})
  };
}

/**
 * Partida guardada → partida utilizable, o null si no se puede reconocer.
 * Acepta la versión 0 (sin `v`) y la actual; completa campos que faltan con
 * sus valores por defecto. Rechaza si faltan jugadores, temas o la ronda, o
 * si la ronda apunta a un tema que no existe.
 */
export function parseGame(v: unknown): GameState | null {
  if (!isObj(v)) return null;
  if (v.v !== undefined && (!isInt(v.v) || v.v > SCHEMA_VERSION)) return null; // de una versión futura: no adivinar
  if (!Array.isArray(v.players) || !Array.isArray(v.tracks) || !PHASES.includes(v.phase as Phase)) return null;
  const players = v.players.map(parsePlayer);
  const tracks = v.tracks.map(parseTrack);
  if (players.some((p) => !p) || tracks.some((t) => !t)) return null;
  const round = parseRound(v.round);
  if (!round) return null;
  const phase = v.phase as Phase;
  if (phase !== 'lobby' && phase !== 'finished' && round.trackIndex >= tracks.length) return null;
  const history = Array.isArray(v.history) ? v.history.map(parseRound) : [];
  if (history.some((r) => !r)) return null;
  return {
    id: isStr(v.id) ? v.id : `recuperada-${Date.now().toString(36)}`,
    createdAt: isNum(v.createdAt) ? v.createdAt : Date.now(),
    ...(isNum(v.finishedAt) ? { finishedAt: v.finishedAt } : {}),
    players: players as Player[],
    tracks: tracks as Track[],
    settings: parseSettings(v.settings),
    phase,
    round,
    history: history as Round[],
    ...(isStr(v.notice) ? { notice: v.notice } : {})
  };
}
