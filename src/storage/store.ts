// Persistencia en localStorage del navegador del juez.
//
// Dos reglas (auditoría 2, B04 y B06):
// - Un guardado que falla se informa: `write()` devuelve false y avisa a la
//   interfaz, que ofrece descargar un respaldo o liberar espacio.
// - Lo que se lee se valida. Lo que no se puede recuperar se aparta a una
//   copia de diagnóstico (`en1nota.quarantine.*`) y se informa; nunca se
//   borran en bloque listas e historial por un dato dañado.
import type { GameState, Settings, Track } from '../game/types.ts';
import { SCHEMA_VERSION, parseGame, parseTrack } from './schema.ts';

const K = {
  game: 'en1nota.game',
  playlists: 'en1nota.playlists',
  history: 'en1nota.history',
  settings: 'en1nota.settings',
  name: 'en1nota.playerName',
  playerMode: 'en1nota.playerMode',
  connectDevice: 'en1nota.connectDevice'
} as const;
const QUARANTINE = 'en1nota.quarantine.';
/** Nunca van en un respaldo: credenciales de Spotify. */
const SECRET_KEYS = ['en1nota.spotify.token', 'en1nota.spotify.verifier', 'en1nota.spotify.return'];

// ---------- avisos para la interfaz ----------

export type StorageIssue =
  | { kind: 'write-failed'; what: string; quota: boolean }
  | { kind: 'recovered'; what: string; detail: string };

const listeners = new Set<(i: StorageIssue) => void>();
const pending: StorageIssue[] = [];

/** Se suscribe a los avisos; recibe también los ocurridos antes de suscribirse. */
export function onStorageIssue(cb: (i: StorageIssue) => void) {
  listeners.add(cb);
  pending.splice(0).forEach(cb);
  return () => { listeners.delete(cb); };
}
function report(i: StorageIssue) {
  if (listeners.size === 0) pending.push(i);
  listeners.forEach((l) => l(i));
}

const LABEL: Record<string, string> = {
  [K.game]: 'la partida',
  [K.playlists]: 'las listas',
  [K.history]: 'el historial',
  [K.settings]: 'las reglas',
  [K.name]: 'tu nombre',
  [K.playerMode]: 'el reproductor elegido',
  [K.connectDevice]: 'el dispositivo de Spotify'
};

function isQuota(e: unknown) {
  return e instanceof Error && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(e.message));
}

// ---------- lectura y escritura ----------

function readRaw(key: string): unknown {
  let raw: string | null;
  try { raw = localStorage.getItem(key); } catch { return undefined; }
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return new BrokenJson(raw); }
}
class BrokenJson {
  raw: string;
  constructor(raw: string) { this.raw = raw; }
}

function read<T>(key: string, fallback: T, ok: (v: unknown) => boolean = () => true): T {
  const v = readRaw(key);
  return v === undefined || v instanceof BrokenJson || !ok(v) ? fallback : (v as T);
}

/** Guarda; devuelve false (y avisa) si el navegador no lo permitió. */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    report({ kind: 'write-failed', what: LABEL[key] ?? key, quota: isQuota(e) });
    return false;
  }
}

/** Aparta un dato dañado para diagnóstico. Si no hay lugar, lo deja donde está. */
function quarantine(key: string, value: unknown): boolean {
  const raw = value instanceof BrokenJson ? value.raw : JSON.stringify(value);
  const base = `${QUARANTINE}${key.replace(/^en1nota\./, '')}.${Date.now()}`;
  try {
    // Nunca pisar una copia anterior (dos en el mismo milisegundo).
    let k = base;
    for (let n = 1; localStorage.getItem(k) !== null; n++) k = `${base}-${n}`;
    localStorage.setItem(k, raw);
    return true;
  } catch {
    return false;
  }
}

// ---------- partida ----------

/** Partida guardada, validada y migrada. null si no hay o no se pudo recuperar. */
export function loadGame(): GameState | null {
  const raw = readRaw(K.game);
  if (raw === undefined) return null;
  const game = raw instanceof BrokenJson ? null : parseGame(raw);
  if (game) return game;
  const kept = quarantine(K.game, raw);
  if (kept) { try { localStorage.removeItem(K.game); } catch { /* nada */ } }
  report({
    kind: 'recovered',
    what: 'la partida',
    detail: kept
      ? 'La partida guardada estaba dañada y no se pudo recuperar: se apartó una copia para diagnóstico y empezás una nueva. Tus listas e historial no se tocaron.'
      : 'La partida guardada estaba dañada y no se pudo recuperar. No hubo lugar para apartar una copia: descargá un respaldo antes de liberar espacio.'
  });
  return null;
}

/** Aparta la partida guardada (con copia de diagnóstico) sin tocar lo demás. */
export function discardSavedGame(): void {
  const raw = readRaw(K.game);
  if (raw === undefined) return;
  if (quarantine(K.game, raw)) { try { localStorage.removeItem(K.game); } catch { /* nada */ } }
}

export function saveGame(g: GameState | null): boolean {
  if (!g) {
    try { localStorage.removeItem(K.game); } catch { /* nada */ }
    return true;
  }
  return write(K.game, { ...g, v: SCHEMA_VERSION });
}

// ---------- listas ----------

export interface SavedPlaylist {
  id: string;
  name: string;
  tracks: Track[];
  updatedAt: number;
}

function parsePlaylist(v: unknown): SavedPlaylist | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.tracks)) return null;
  const tracks = o.tracks.map(parseTrack);
  if (tracks.some((t) => !t)) return null;
  return { id: o.id, name: o.name, tracks: tracks as Track[], updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0 };
}

/** Lee una colección: conserva las entradas válidas y aparta (sin perder) las dañadas. */
function loadCollection<T>(key: string, parse: (v: unknown) => T | null, what: string): T[] {
  const raw = readRaw(key);
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    if (quarantine(key, raw)) { try { localStorage.removeItem(key); } catch { /* nada */ } }
    report({ kind: 'recovered', what, detail: `No se pudo leer ${what}: se apartó una copia para diagnóstico.` });
    return [];
  }
  const good: T[] = [];
  const bad: unknown[] = [];
  for (const item of raw) {
    const p = parse(item);
    if (p) good.push(p); else bad.push(item);
  }
  if (bad.length > 0 && quarantine(key, bad)) {
    write(key, good);
    report({ kind: 'recovered', what, detail: `${bad.length} ${bad.length === 1 ? 'entrada dañada' : 'entradas dañadas'} de ${what} se apartaron para diagnóstico; el resto está intacto.` });
  }
  return good;
}

export const loadPlaylists = () => loadCollection(K.playlists, parsePlaylist, 'las listas');

/** Devuelve false si no se pudo guardar (p. ej. almacenamiento lleno). */
export function savePlaylist(p: SavedPlaylist): boolean {
  const all = loadPlaylists().filter((x) => x.id !== p.id);
  return write(K.playlists, [p, ...all].slice(0, 50));
}
export function deletePlaylist(id: string): boolean {
  return write(K.playlists, loadPlaylists().filter((x) => x.id !== id));
}

// ---------- historial ----------

export interface HistoryEntry {
  id: string;
  playedAt: number;
  trackCount: number;
  players: Array<{ name: string; score: number; color: string }>;
  game: GameState;
}

function parseHistoryEntry(v: unknown): HistoryEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const game = parseGame(o.game);
  if (typeof o.id !== 'string' || typeof o.playedAt !== 'number' || !game) return null;
  return {
    id: o.id,
    playedAt: o.playedAt,
    trackCount: typeof o.trackCount === 'number' ? o.trackCount : game.history.length,
    players: game.players.map((p) => ({ name: p.name, score: p.score, color: p.color })),
    game
  };
}

export const loadHistory = () => loadCollection(K.history, parseHistoryEntry, 'el historial');

export function pushHistory(g: GameState): boolean {
  const entry: HistoryEntry = {
    id: g.id,
    playedAt: g.finishedAt ?? Date.now(),
    trackCount: g.history.length,
    players: g.players.map((p) => ({ name: p.name, score: p.score, color: p.color })),
    game: g
  };
  return write(K.history, [entry, ...loadHistory().filter((h) => h.id !== g.id)].slice(0, 30));
}
export function deleteHistory(id: string): boolean {
  return write(K.history, loadHistory().filter((h) => h.id !== id));
}

// ---------- preferencias ----------

const isObjVal = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const loadSettings = () => read<Partial<Settings>>(K.settings, {}, isObjVal);
export const saveSettings = (s: Settings) => write(K.settings, s);

export const loadPlayerName = () => read<string>(K.name, '', (v) => typeof v === 'string');
export const savePlayerName = (n: string) => write(K.name, n);

export type PlayerModeSetting = 'sdk' | 'connect' | 'manual';
export const loadPlayerMode = () => read<PlayerModeSetting | null>(K.playerMode, null, (v) => v === 'sdk' || v === 'connect' || v === 'manual');
export const savePlayerMode = (m: PlayerModeSetting) => write(K.playerMode, m);
export const loadConnectDevice = () => read<string | null>(K.connectDevice, null, (v) => typeof v === 'string');
export const saveConnectDevice = (id: string) => write(K.connectDevice, id);

// ---------- respaldo y espacio ----------

/**
 * Respaldo en JSON de todo lo de En 1 Nota en este navegador, incluidas las
 * copias de diagnóstico, más lo que está en memoria (`extra`, p. ej. la
 * partida en curso que no se pudo guardar). Nunca incluye credenciales.
 */
export function exportBackup(extra: Record<string, unknown> = {}): string {
  const data: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('en1nota.') || SECRET_KEYS.includes(k)) continue;
      const raw = localStorage.getItem(k);
      try { data[k] = JSON.parse(raw ?? 'null'); } catch { data[k] = raw; }
    }
  } catch { /* sin acceso: va sólo lo que está en memoria */ }
  return JSON.stringify({ app: 'en1nota', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), storage: data, memory: extra }, null, 2);
}

/** Libera espacio borrando copias de diagnóstico (y el historial si se pide). Devuelve cuántas claves borró. */
export function freeSpace({ history = false } = {}): number {
  const doomed: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(QUARANTINE) || (history && k === K.history))) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch { /* nada */ }
  return doomed.length;
}
