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
}

export interface Settings {
  /** Duración de cada pasada del fragmento, en ms. */
  steps: number[];
  /** Puntos por acertar en cada pasada (si faltan, se usa el último). */
  pointsCorrect: number[];
  pointsWrong: number;
  pointsHum: number;
  /** Ventana para ordenar pulsaciones casi simultáneas. */
  buzzWindowMs: number;
  /** Cuánto suena la canción al revelarla. */
  revealMs: number;
  /** El que falló queda bloqueado en ese tema. */
  lockOnFail: boolean;
}

export type Phase =
  | 'lobby'     // armando jugadores y lista
  | 'ready'     // tema cargado, todavía no sonó
  | 'playing'   // fragmento sonando, pulsadores abiertos
  | 'open'      // fragmento terminó, pulsadores abiertos
  | 'buzzed'    // alguien tiene la palabra
  | 'revealed'  // se mostró la canción
  | 'finished';

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
  events: RoundEvent[];
  solvedBy?: string;
  /** Instante (reloj del host) en que arrancó a sonar la última pasada. */
  playStartedAt?: number;
}

export interface Buzz {
  playerId: string;
  /** Instante en reloj sincronizado (servidor) o local en modo mesa. */
  at: number;
}

export interface GameState {
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
  solvedBy?: string;
  revealed?: Pick<Track, 'name' | 'artists' | 'album' | 'image'>;
  notice?: string;
  lastEvent?: RoundEvent;
  finished: boolean;
  awards?: Array<{ k: string; v: string; sub: string }>;
}

export const PLAYER_COLORS = [
  '#ff2d75', '#2dd4ff', '#ffd23f', '#7cff5c',
  '#b06cff', '#ff8a2d', '#2dffc4', '#ff5c5c'
];

export const DEFAULT_SETTINGS: Settings = {
  steps: [400, 1200, 3000, 8000],
  pointsCorrect: [1],
  pointsWrong: -1,
  pointsHum: -1,
  buzzWindowMs: 150,
  revealMs: 12000,
  lockOnFail: true
};
