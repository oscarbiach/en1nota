export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  image?: string;
  durationMs: number;
  /** Desde dónde arranca el fragmento (ms). */
  startMs: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  score: number;
  connected: boolean;
  /** Tecla asignada en modo mesa (1-8). */
  key?: string;
  /** Juega desde su celular (no desde la pantalla del juez). */
  remote?: boolean;
}

export interface Settings {
  /** Duración de cada pasada del fragmento, en ms. */
  steps: number[];
  /** Puntos por acertar en cada pasada (si faltan, se usa el último). */
  pointsCorrect: number[];
  pointsWrong: number;
  /** Ventana para ordenar pulsaciones casi simultáneas. */
  buzzWindowMs: number;
  /** Cuánto suena la canción al revelarla. */
  revealMs: number;
  /** El que falló queda bloqueado en ese tema. */
  lockOnFail: boolean;
  /** Mezclar la lista al empezar cada partida. */
  shuffleOnStart: boolean;
}

export type Phase =
  | 'lobby'     // armando jugadores y lista
  | 'ready'     // tema cargado, todavía no sonó
  | 'playing'   // fragmento sonando, pulsadores abiertos
  | 'open'      // fragmento terminó, pulsadores abiertos
  | 'buzzed'    // alguien tiene la palabra
  | 'revealed'  // se mostró la canción
  | 'finished';

/** 'hum' (tarareo) ya no se genera: sólo puede venir de partidas guardadas antes de quitarlo. */
export type RoundEventKind = 'buzz' | 'correct' | 'wrong' | 'hum' | 'timeout' | 'replay' | 'reveal';

export interface RoundEvent {
  kind: RoundEventKind;
  playerId?: string;
  step: number;
  points?: number;
  at: number;
  /** Milisegundos entre que arrancó el fragmento y la pulsación. */
  reactionMs?: number;
}

export interface Round {
  trackIndex: number;
  step: number;
  lockedPlayerIds: string[];
  buzzedPlayerId?: string;
  /** Pulsaciones en espera dentro de la ventana de empate. */
  pending: Buzz[];
  /** Pulsaciones ya ordenadas que esperan su turno. Ausente en partidas antiguas. */
  queue?: Buzz[];
  /** En autoevaluación ya se consultó la respuesta: nadie más puede sumarse. */
  answerShown?: boolean;
  /** Límite en el reloj sincronizado del servidor; no se reinicia al repetir. */
  answerDeadline?: number;
  events: RoundEvent[];
  solvedBy?: string;
  /** Instante (reloj del host) en que arrancó a sonar la última pasada. */
  playStartedAt?: number;
  /** La partida terminó con este tema a medio jugar (sin revelar). */
  abandoned?: boolean;
}

export interface Buzz {
  playerId: string;
  /** Instante en reloj sincronizado (servidor) o local en modo mesa. */
  at: number;
}

export interface GameState {
  mode?: 'party' | 'solo' | 'duel';
  soloAnswer?: 'write' | 'self';
  id: string;
  createdAt: number;
  finishedAt?: number;
  players: Player[];
  tracks: Track[];
  settings: Settings;
  phase: Phase;
  round: Round;
  /** Rondas cerradas, en orden. */
  history: Round[];
  /** Mensaje corto para mostrar en TV / celulares. */
  notice?: string;
}

/** Lo que ven jugadores y TV: nunca incluye el título antes de revelar. */
export interface PublicState {
  phase: Phase;
  players: Array<Pick<Player, 'id' | 'name' | 'color' | 'score' | 'connected'>>;
  trackIndex: number;
  trackCount: number;
  step: number;
  stepMs: number;
  stepCount: number;
  lockedPlayerIds: string[];
  buzzedPlayerId?: string;
  queuedPlayerIds?: string[];
  answersClosed?: boolean;
  solvedBy?: string;
  revealed?: Pick<Track, 'name' | 'artists' | 'album' | 'image'>;
  notice?: string;
  lastEvent?: RoundEvent;
  finished: boolean;
  awards?: Array<{ k: string; v: string; sub: string }>;
  /** Resultado final calculado por el motor: la TV lo muestra tal cual. */
  final?: FinalResult;
}

/** Ranking con posiciones compartidas en caso de empate (1, 1, 3…). */
export interface FinalResult {
  ranking: Array<{ id: string; position: number; score: number; correct: number }>;
  winnerIds: string[];
}

export const PLAYER_COLORS = [
  '#ff2d75', '#2dd4ff', '#ffd23f', '#7cff5c',
  '#b06cff', '#ff8a2d', '#2dffc4', '#ff5c5c'
];

export const DEFAULT_SETTINGS: Settings = {
  steps: [400, 1200, 3000, 8000],
  pointsCorrect: [1],
  pointsWrong: -1,
  buzzWindowMs: 150,
  revealMs: 12000,
  lockOnFail: true,
  shuffleOnStart: true
};
