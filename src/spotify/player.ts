// Reproductor de fragmentos. Dos implementaciones con la misma interfaz:
//  - SdkPlayer: Web Playback SDK, suena en este navegador (notebook / Android).
//    La pausa es local, así que el fragmento dura lo que pedimos con precisión
//    de decenas de ms.
//  - ConnectPlayer: manda play/pause por la Web API a otro dispositivo (la app
//    de Spotify del iPhone, un parlante). La duración depende de la latencia
//    de red: sirve para 500 ms o más, no para "una nota".
//  - ManualPlayer (manual.ts): sin Spotify, sólo cuenta el tiempo.
// Todos cumplen el contrato de run.ts: cada operación termina siempre, y una
// nueva (o stop) cancela la anterior.
import { getAccessToken } from './auth';
import { devices, pauseRemote, playUri, transferTo, type Device } from './api';
import { Runner, runSnippet, type SnippetResult } from './run';

export { ManualPlayer } from './manual';

export type PlayerMode = 'sdk' | 'connect' | 'manual';

export interface SnippetPlayer {
  readonly mode: PlayerMode;
  readonly ready: boolean;
  readonly deviceId?: string;
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

export function sdkSupported(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !iOS && typeof window !== 'undefined' && 'MediaSource' in window;
}

let sdkLoading: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkLoading ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => reject(new Error('No se pudo cargar el SDK de Spotify'));
    document.head.appendChild(s);
  });
  return sdkLoading;
}

export class SdkPlayer implements SnippetPlayer {
  readonly mode = 'sdk';
  ready = false;
  deviceId?: string;
  onStatus?: (s: string) => void;
  private player?: Spotify.Player;
  private state: Spotify.PlaybackState | null = null;
  private stateWaiters: Array<(s: Spotify.PlaybackState) => void> = [];
  private runner = new Runner();

  async init() {
    if (this.ready) return;
    this.onStatus?.('Cargando SDK…');
    await loadSdk();
    const player = new window.Spotify!.Player({
      name: 'En 1 Nota',
      getOAuthToken: (cb) => { getAccessToken().then(cb).catch(() => cb('')); },
      volume: 1
    });
    this.player = player;
    player.addListener('player_state_changed', (s) => {
      this.state = s;
      if (s && !s.paused) {
        const w = this.stateWaiters;
        this.stateWaiters = [];
        w.forEach((fn) => fn(s));
      }
    });
    for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error'] as const) {
      player.addListener(ev, (e) => this.onStatus?.(`${ev}: ${e.message}`));
    }
    const readyP = new Promise<string>((resolve, reject) => {
      player.addListener('ready', ({ device_id }) => resolve(device_id));
      player.addListener('not_ready', () => { this.ready = false; });
      setTimeout(() => reject(new Error('El SDK no se conectó a tiempo')), 15000);
    });
    // activateElement: necesario en móviles para que el navegador deje sonar.
    try { await player.activateElement(); } catch { /* opcional en desktop */ }
    const ok = await player.connect();
    if (!ok) throw new Error('Spotify rechazó la conexión del reproductor');
    this.deviceId = await readyP;
    this.ready = true;
    this.onStatus?.('Reproductor listo');
    // Nos hacemos el dispositivo activo para que los comandos vayan acá.
    try { await transferTo(this.deviceId, false); } catch { /* si falla, play?device_id= lo resuelve */ }
  }

  private waitPlaying(uri: string, timeoutMs = 6000): Promise<Spotify.PlaybackState> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Spotify no arrancó a reproducir')), timeoutMs);
      const check = (s: Spotify.PlaybackState) => {
        if (s.track_window.current_track.uri === uri || !s.paused) { clearTimeout(t); resolve(s); }
        else this.stateWaiters.push(check);
      };
      if (this.state && !this.state.paused && this.state.track_window.current_track.uri === uri) { clearTimeout(t); resolve(this.state); return; }
      this.stateWaiters.push(check);
    });
  }

  async play(uri: string, startMs: number, maxMs?: number) {
    if (!this.ready || !this.player) throw new Error('Reproductor no inicializado');
    const player = this.player;
    const op = this.runner.begin();
    await runSnippet(async () => {
      await op.wait(playUri(this.deviceId, uri, startMs));
      await op.wait(this.waitPlaying(uri));
      if (!maxMs) return;
      await op.sleep(maxMs);
      await player.pause();
    });
  }

  playSnippet(uri: string, startMs: number, lenMs: number) {
    if (!this.ready || !this.player) return Promise.reject(new Error('Reproductor no inicializado'));
    const player = this.player;
    const op = this.runner.begin();
    return runSnippet(async () => {
      await op.wait(playUri(this.deviceId, uri, startMs));
      const s = await op.wait(this.waitPlaying(uri));
      // Compensamos lo que ya avanzó entre que arrancó y nos enteramos.
      const already = Math.max(0, s.position - startMs);
      await op.sleep(Math.max(0, lenMs - already));
      await player.pause();
    });
  }

  async stop() {
    this.runner.cancel();
    try { await this.player?.pause(); } catch { /* ya pausado */ }
  }

  destroy() {
    this.runner.cancel();
    this.player?.disconnect();
    this.ready = false;
  }
}

export class ConnectPlayer implements SnippetPlayer {
  readonly mode = 'connect';
  ready = false;
  deviceId?: string;
  onStatus?: (s: string) => void;
  private runner = new Runner();
  /** Latencia medida del comando play, para descontarla del pause. */
  private lastPlayLatency = 250;
  private device?: Device;

  constructor(device?: Device) {
    this.device = device;
    this.deviceId = device?.id;
  }

  async listDevices() {
    return devices();
  }

  setDevice(d: Device) {
    this.device = d;
    this.deviceId = d.id;
  }

  async init() {
    if (!this.deviceId) {
      const ds = await devices();
      const d = ds.find((x) => x.is_active) ?? ds[0];
      if (!d) throw new Error('Abrí la app de Spotify en algún dispositivo y volvé a intentar.');
      this.setDevice(d);
    }
    this.ready = true;
    this.onStatus?.(`Controlando: ${this.device?.name}`);
  }

  async play(uri: string, startMs: number, maxMs?: number) {
    const op = this.runner.begin();
    await runSnippet(async () => {
      await op.wait(playUri(this.deviceId, uri, startMs));
      if (!maxMs) return;
      await op.sleep(maxMs);
      await pauseRemote(this.deviceId);
    });
  }

  playSnippet(uri: string, startMs: number, lenMs: number) {
    const op = this.runner.begin();
    return runSnippet(async () => {
      const t0 = performance.now();
      await op.wait(playUri(this.deviceId, uri, startMs));
      this.lastPlayLatency = performance.now() - t0;
      // Suponemos que el pause tarda parecido al play: lo mandamos antes.
      await op.sleep(Math.max(0, lenMs - this.lastPlayLatency * 0.5));
      await pauseRemote(this.deviceId);
    });
  }

  async stop() {
    this.runner.cancel();
    await pauseRemote(this.deviceId);
  }

  destroy() {
    this.runner.cancel();
    this.ready = false;
  }
}
