// Lo que el controlador del juez (Host) comparte con sus pantallas. Sólo
// tipos, en su propio archivo: las pantallas no importan Host.
import type { GameState } from '../game/types';
import type { HostConnection } from '../net/host';
import type { PeerInfo, SfxName } from '../net/protocol';
import type { SnippetPlayer } from '../spotify/player';

export interface JoinRequest {
  pid: string;
  name: string;
}

export interface HostCtx {
  game: GameState;
  update: (fn: (g: GameState) => GameState) => void;
  room?: string;
  online: boolean;
  peers: Map<string, PeerInfo>;
  conn: HostConnection;
  player: SnippetPlayer | null;
  playerStatus: string;
  setPlayer: (p: SnippetPlayer | null) => void;
  setPlayerStatus: (s: string) => void;
  localSfx: boolean;
  setLocalSfx: (v: boolean) => void;
  sfx: (name: SfxName, playerId?: string) => void;
  /** Pulsación (de celu o de pantalla), con instante en reloj del servidor. */
  buzz: (pid: string, at: number) => void;
  /**
   * Hora del servidor según el reloj sincronizado del juez (B03). Inicio del
   * fragmento y pulsaciones usan esta misma base, así la reacción no depende
   * de cuán desfasado esté el reloj de la compu del juez.
   */
  now: () => number;
  /** Saca a un jugador: de la partida y de la sala. */
  kick: (pid: string) => void;
  /** Celulares que piden entrar con la partida empezada. */
  joinRequests: JoinRequest[];
  /** `target`: id del jugador que retoma, 'new' para sumarlo, 'reject' para rechazar. */
  resolveJoin: (pid: string, target: string) => void;
  /** Código anterior si la sala cambió durante la partida. */
  roomChangedFrom?: string;
  dismissRoomChanged: () => void;
  /** El servidor no admite más salas por ahora (se reintenta solo). */
  serverFull: boolean;
  loggedIn: boolean;
  setLoggedIn: (v: boolean) => void;
}
