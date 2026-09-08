// Reproductor de fragmentos. Dos implementaciones con la misma interfaz:
//  - SdkPlayer: Web Playback SDK, suena en este navegador (notebook / Android).
//    La pausa es local, así que el fragmento dura lo que pedimos con precisión
//    de decenas de ms.
//  - ConnectPlayer: manda play/pause por la Web API a otro dispositivo (la app
//    de Spotify del iPhone, un parlante). La duración depende de la latencia
//    de red: sirve para 500 ms o más, no para "una nota".
import { getAccessToken } from './auth';
import { devices, pauseRemote, playUri, transferTo, type Device } from './api';

export type PlayerMode = 'sdk' | 'connect';

export interface SnippetPlayer {
  readonly mode: PlayerMode;
  readonly ready: boolean;
  readonly deviceId?: string;
  /** Hay que llamarlo desde un gesto del usuario (click/tap). */
  init(): Promise<void>;
  /** Reproduce `lenMs` a partir de `startMs`. Resuelve cuando terminó. */
  playSnippet(uri: string, startMs: number, lenMs: number): Promise<void>;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SdkPlayer implements SnippetPlayer {
  readonly mode = 'sdk';
  ready = false;
  deviceId?: string;
  onStatus?: (s: string) => void;
  private player?: Spotify.Player;
  private state: Spotify.PlaybackState | null = null;
  private stateWaiters: Array<(s: Spotify.PlaybackState) => void> = [];
  private stopTimer?: number;
  private session = 0;

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
    const mine = ++this.session;
    clearTimeout(this.stopTimer);
    await playUri(this.deviceId, uri, startMs);
    await this.waitPlaying(uri);
    if (mine !== this.session) return;
    if (maxMs) this.stopTimer = window.setTimeout(() => { if (mine === this.session) void this.stop(); }, maxMs);
  }

  async playSnippet(uri: string, startMs: number, lenMs: number) {
    if (!this.ready || !this.player) throw new Error('Reproductor no inicializado');
    const mine = ++this.session;
    clearTimeout(this.stopTimer);
    await playUri(this.deviceId, uri, startMs);
    const s = await this.waitPlaying(uri);
    if (mine !== this.session) return;
    // Compensamos lo que ya avanzó entre que arrancó y nos enteramos.
    const already = Math.max(0, s.position - startMs);
    const wait = Math.max(0, lenMs - already);
    await new Promise<void>((resolve) => {
      this.stopTimer = window.setTimeout(resolve, wait);
    });
    if (mine !== this.session) return;
    await this.player.pause();
  }

  async stop() {
    this.session++;
    clearTimeout(this.stopTimer);
    try { await this.player?.pause(); } catch { /* ya pausado */ }
  }

  destroy() {
    this.session++;
    clearTimeout(this.stopTimer);
    this.player?.disconnect();
    this.ready = false;
  }
}

export class ConnectPlayer implements SnippetPlayer {
  readonly mode = 'connect';
  ready = false;
  deviceId?: string;
  onStatus?: (s: string) => void;
  private stopTimer?: number;
  private session = 0;
  /** Latencia medida del comando play, para descontarla del pause. */
  private lastPlayLatency = 250;

  constructor(private device?: Device) {
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
    const mine = ++this.session;
    clearTimeout(this.stopTimer);
    await playUri(this.deviceId, uri, startMs);
    if (maxMs) this.stopTimer = window.setTimeout(() => { if (mine === this.session) void this.stop(); }, maxMs);
  }

  async playSnippet(uri: string, startMs: number, lenMs: number) {
    const mine = ++this.session;
    clearTimeout(this.stopTimer);
    const t0 = performance.now();
    await playUri(this.deviceId, uri, startMs);
    this.lastPlayLatency = performance.now() - t0;
    if (mine !== this.session) return;
    // Suponemos que el pause tarda parecido al play: lo mandamos antes.
    const wait = Math.max(0, lenMs - this.lastPlayLatency * 0.5);
    await sleep(wait);
    if (mine !== this.session) return;
    await pauseRemote(this.deviceId);
  }

  async stop() {
    this.session++;
    clearTimeout(this.stopTimer);
    await pauseRemote(this.deviceId);
  }

  destroy() {
    this.session++;
    clearTimeout(this.stopTimer);
    this.ready = false;
  }
}

/**
 * Sin Spotify: el juez pone la música por su cuenta (parlante, otra app).
 * La app solo cuenta el tiempo del fragmento para abrir los pulsadores y
 * llevar el puntaje. Sirve de respaldo si Spotify falla en plena juntada.
 */
export class ManualPlayer implements SnippetPlayer {
  readonly mode = 'connect';
  ready = true;
  deviceId = undefined;
  onStatus?: (s: string) => void;
  private timer?: number;
  private session = 0;
  readonly manual = true;

  async init() {
    this.onStatus?.('Sin reproductor: la música la ponés vos');
  }
  async playSnippet(_uri: string, _startMs: number, lenMs: number) {
    const mine = ++this.session;
    await new Promise<void>((r) => { this.timer = window.setTimeout(r, lenMs); });
    if (mine !== this.session) return;
  }
  async play() { this.session++; clearTimeout(this.timer); }
  async stop() { this.session++; clearTimeout(this.timer); }
  destroy() { this.session++; clearTimeout(this.timer); }
}
