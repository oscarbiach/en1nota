import type { PublicState } from '../game/types';

/** Mensajes jugador/pantalla → juez. */
export type PeerMsg =
  | { k: 'hello'; role: 'player' | 'screen'; name: string }
  | { k: 'buzz'; at: number; localAt: number }
  | { k: 'rename'; name: string };

/** Mensajes juez → jugadores/pantalla. */
export type HostMsg =
  | { k: 'state'; state: PublicState; serverNow: number }
  | { k: 'welcome'; playerId: string; name: string; color: string }
  | { k: 'rejected'; reason: string }
  | { k: 'sfx'; name: SfxName; playerId?: string };

export type SfxName = 'buzz' | 'correct' | 'wrong' | 'hum' | 'reveal' | 'start' | 'tick' | 'finish';

export type ServerMsg =
  | { t: 'pong'; c: number; s: number }
  | { t: 'hosted'; room: string; key: string; peers: PeerInfo[] }
  | { t: 'joined'; room: string; pid: string; hostOnline: boolean }
  | { t: 'peer'; pid: string; role: 'player' | 'screen'; name: string; connected: boolean }
  | { t: 'msg'; from?: string; data: PeerMsg | HostMsg; at?: number }
  | { t: 'error'; code: string }
  | { t: 'host_gone' }
  | { t: 'host_back' }
  | { t: 'host_replaced' }
  | { t: 'replaced' }
  | { t: 'kicked' }
  | { t: 'room_closed' };

export interface PeerInfo {
  pid: string;
  role: 'player' | 'screen';
  name: string;
  connected: boolean;
}

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function joinUrl(room: string): string {
  return `${location.origin}/#/jugar?sala=${room}`;
}
export function screenUrl(room: string): string {
  return `${location.origin}/#/tv?sala=${room}`;
}
