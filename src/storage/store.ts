// Persistencia en localStorage del navegador del juez.
import type { GameState, Settings, Track } from '../game/types';

const K = {
  game: 'en1nota.game',
  playlists: 'en1nota.playlists',
  history: 'en1nota.history',
  settings: 'en1nota.settings',
  name: 'en1nota.playerName',
  playerMode: 'en1nota.playerMode',
  connectDevice: 'en1nota.connectDevice'
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* lleno o bloqueado */ }
}

export const loadGame = () => read<GameState | null>(K.game, null);
export const saveGame = (g: GameState | null) => (g ? write(K.game, g) : localStorage.removeItem(K.game));

export interface SavedPlaylist {
  id: string;
  name: string;
  tracks: Track[];
  updatedAt: number;
}
export const loadPlaylists = () => read<SavedPlaylist[]>(K.playlists, []);
export function savePlaylist(p: SavedPlaylist) {
  const all = loadPlaylists().filter((x) => x.id !== p.id);
  write(K.playlists, [p, ...all].slice(0, 50));
}
export function deletePlaylist(id: string) {
  write(K.playlists, loadPlaylists().filter((x) => x.id !== id));
}

export interface HistoryEntry {
  id: string;
  playedAt: number;
  trackCount: number;
  players: Array<{ name: string; score: number; color: string }>;
  game: GameState;
}
export const loadHistory = () => read<HistoryEntry[]>(K.history, []);
export function pushHistory(g: GameState) {
  const entry: HistoryEntry = {
    id: g.id,
    playedAt: g.finishedAt ?? Date.now(),
    trackCount: g.history.length,
    players: g.players.map((p) => ({ name: p.name, score: p.score, color: p.color })),
    game: g
  };
  write(K.history, [entry, ...loadHistory().filter((h) => h.id !== g.id)].slice(0, 30));
}
export function deleteHistory(id: string) {
  write(K.history, loadHistory().filter((h) => h.id !== id));
}

export const loadSettings = () => read<Partial<Settings>>(K.settings, {});
export const saveSettings = (s: Settings) => write(K.settings, s);

export const loadPlayerName = () => read<string>(K.name, '');
export const savePlayerName = (n: string) => write(K.name, n);

export type PlayerModeSetting = 'sdk' | 'connect' | 'manual';
export const loadPlayerMode = () => read<PlayerModeSetting | null>(K.playerMode, null);
export const savePlayerMode = (m: PlayerModeSetting) => write(K.playerMode, m);
export const loadConnectDevice = () => read<string | null>(K.connectDevice, null);
export const saveConnectDevice = (id: string) => write(K.connectDevice, id);
