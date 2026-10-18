// Contrato común de los reproductores (SDK, Connect, manual).
import type { SnippetResult } from './run.ts';

export type PlayerMode = 'sdk' | 'connect' | 'preview' | 'manual';

export interface SnippetPlayer {
  readonly mode: PlayerMode;
  readonly ready: boolean;
  readonly deviceId?: string;
  /** Spotify Connect: nombre del aparato donde suena. */
  readonly deviceName?: string;
  /** Hay que llamarlo desde un gesto del usuario (click/tap). */
  init(): Promise<void>;
  /**
   * Reproduce `lenMs` a partir de `startMs`. Resuelve 'done' al terminar o
   * 'cancelled' si llamaron stop() o empezó otro fragmento. Nunca queda colgada.
   */
  playSnippet(uri: string, startMs: number, lenMs: number): Promise<SnippetResult>;
  /** Reproduce sin tope hasta que llamen stop() o pase `maxMs`. */
  play(uri: string, startMs: number, maxMs?: number): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
  onStatus?: (s: string) => void;
}
