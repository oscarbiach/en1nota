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
import { getAccessToken } from './auth.ts';
import { SpotifyError, devices, pauseRemote, playUri, playbackState, transferTo, type Device, type PlaybackState } from './api.ts';
import { Cancelled, Runner, runSnippet, type Op } from './run.ts';

export { ManualPlayer } from './manual.ts';

/** Cuánto esperamos la confirmación del SDK antes de contar el fragmento desde la orden. */
const CONFIRM_MS = 2000;
/** Spotify Connect: cada cuánto y cuántas veces preguntamos si ya suena (≈5 s). */
const CONNECT_CONFIRM_EVERY_MS = 400;
const CONNECT_CONFIRM_TRIES = 13;

const isDeviceNotFound = (e: unknown) => e instanceof SpotifyError && e.status === 404;

/**
 * Espera `p` como máximo `ms`. El SDK de Spotify puede no contestar nunca
 * (se desconectó, la cuenta pasó a sonar en otro aparato): sin este tope, el
 * panel del juez quedaba esperando para siempre.
 */
function withTimeout<T>(p: Promise<T> | undefined, ms: number, message: string): Promise<T | undefined> {
  if (!p) return Promise.resolve(undefined);
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(t));
}

export type { PlayerMode, SnippetPlayer } from './snippet.ts';
import type { SnippetPlayer } from './snippet.ts';

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
    player.addListener('player_state_changed', (s) => this.handleState(s));
    for (const ev of ['initialization_error', 'authentication_error', 'account_error', 'playback_error'] as const) {
      player.addListener(ev, (e) => this.onStatus?.(`${ev}: ${e.message}`));
    }
    const readyP = new Promise<string>((resolve, reject) => {
      // Spotify puede volver a mandar 'ready' con otro device_id si reconecta:
      // siempre usamos el último.
      player.addListener('ready', ({ device_id }) => { this.deviceId = device_id; this.ready = true; resolve(device_id); });
      player.addListener('not_ready', () => {
        this.ready = false;
        this.onStatus?.('El reproductor de este navegador se desconectó. Tocá "Reactivar" en el panel Reproductor.');
      });
      setTimeout(() => reject(new Error('El SDK no se conectó a tiempo')), 15000);
    });
    // activateElement: necesario en móviles para que el navegador deje sonar.
    try { await withTimeout(player.activateElement(), 3000, 'activateElement'); } catch { /* opcional en desktop */ }
    const ok = await withTimeout(player.connect(), 15000, 'El SDK no se conectó a tiempo');
    if (!ok) throw new Error('Spotify rechazó la conexión del reproductor');
    this.deviceId = await readyP;
    this.ready = true;
    this.onStatus?.('Reproductor listo');
    // Nos hacemos el dispositivo activo para que los comandos vayan acá.
    try { await transferTo(this.deviceId, false); } catch { /* si falla, play?device_id= lo resuelve */ }
  }

  /** Cada cambio de estado del SDK. Público para poder probarlo sin el SDK real. */
  handleState(s: Spotify.PlaybackState | null) {
    if (s) [...this.stateWaiters].forEach((fn) => fn(s));
  }

  /**
   * Espera a que suene `uri` desde `startMs` (B01). Sólo cuenta un evento
   * nuevo (no el último estado guardado, que puede ser de la reproducción
   * anterior del mismo tema), no pausado, del tema pedido (o del que Spotify
   * lo reemplazó por disponibilidad regional), y cerca de la posición pedida.
   * Al resolverse, vencer o cancelarse la operación, se retira el listener.
   */
  private waitPlaying(uri: string, startMs: number, op: Op, timeoutMs = 6000): Promise<Spotify.PlaybackState> {
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(t);
        off();
        this.stateWaiters = this.stateWaiters.filter((w) => w !== check);
      };
      const check = (s: Spotify.PlaybackState) => {
        const cur = s.track_window?.current_track;
        const sameTrack = !!cur && (cur.uri === uri || cur.linked_from?.uri === uri);
        const nearStart = s.position >= startMs - 1500 && s.position <= startMs + 4000;
        if (!s.paused && sameTrack && nearStart) { done(); resolve(s); }
      };
      const t = setTimeout(() => { done(); reject(new Error('Spotify no confirmó la reproducción')); }, timeoutMs);
      const off = op.onCancel(done);
      this.stateWaiters.push(check);
    });
  }

  /** Cantidad de esperas activas (para verificar que no quedan colgadas). */
  get pendingWaits() {
    return this.stateWaiters.length;
  }

  /**
   * Manda reproducir en este navegador. Si Spotify todavía no ve el
   * dispositivo ("Device not found": pasa justo después de activarlo, o si
   * se desconectó), le transfiere la reproducción y reintenta; al segundo
   * fallo reconecta el SDK (nuevo dispositivo) y reintenta una vez más.
   */
  private async startPlayback(uri: string, startMs: number, op: Op) {
    for (let attempt = 0; ; attempt++) {
      if (!this.deviceId) throw new Error('El reproductor del navegador no está conectado. Tocá "Reactivar" en el panel Reproductor.');
      try {
        await op.wait(playUri(this.deviceId, uri, startMs));
        return;
      } catch (e) {
        if (!isDeviceNotFound(e)) throw e;
        if (attempt >= 2) throw new Error('Spotify no encuentra el reproductor de este navegador (Device not found). Tocá "Reactivar" en el panel Reproductor; si sigue, cerrá la app de Spotify en otros dispositivos y recargá.');
        if (attempt === 0) { try { await op.wait(transferTo(this.deviceId, false)); } catch { /* reintentamos igual */ } }
        else await op.wait(this.reconnect());
        await op.sleep(700);
      }
    }
  }

  /** Desconecta y vuelve a conectar el SDK: Spotify le da un dispositivo nuevo. */
  private async reconnect() {
    this.player?.disconnect();
    this.player = undefined;
    this.ready = false;
    this.deviceId = undefined;
    await this.init();
  }

  /**
   * Corta el audio. Primero el SDK (inmediato, en este navegador); después,
   * por la API de Spotify, el dispositivo activo de la cuenta: si el audio
   * terminó sonando en otro lado, también se corta.
   */
  private async pauseEverywhere() {
    try { await withTimeout(this.player?.pause(), 1500, 'pause'); } catch { /* ya pausado o SDK sin respuesta */ }
    try { await pauseRemote(); } catch { /* sin dispositivo activo, ya pausado o sin respuesta (api tiene tope) */ }
  }

  async play(uri: string, startMs: number, maxMs?: number) {
    if (!this.ready || !this.player) throw new Error('Reproductor no inicializado');
    const op = this.runner.begin();
    await runSnippet(async () => {
      await this.startPlayback(uri, startMs, op);
      if (!maxMs) return;
      await op.sleep(maxMs);
      await this.pauseEverywhere();
    });
  }

  playSnippet(uri: string, startMs: number, lenMs: number) {
    if (!this.ready || !this.player) return Promise.reject(new Error('Reproductor no inicializado'));
    const op = this.runner.begin();
    return runSnippet(async () => {
      // La espera se registra antes del play: el evento puede llegar enseguida.
      const playing = this.waitPlaying(uri, startMs, op, CONFIRM_MS);
      playing.catch(() => {}); // si play falla, el error que importa es ése
      await this.startPlayback(uri, startMs, op);
      const sentAt = performance.now();
      // Con la confirmación del SDK, descontamos lo que ya sonó. Sin ella
      // (el audio pudo ir a otro dispositivo), contamos desde la orden: el
      // fragmento se corta igual a tiempo.
      const s = await op.wait(playing.catch((e) => (e instanceof Cancelled ? Promise.reject(e) : null)));
      const elapsed = s ? Math.max(0, s.position - startMs) : performance.now() - sentAt;
      await op.sleep(Math.max(0, lenMs - elapsed));
      await this.pauseEverywhere();
    });
  }

  async stop() {
    this.runner.cancel();
    await this.pauseEverywhere();
  }

  destroy() {
    this.runner.cancel();
    this.player?.disconnect();
    this.ready = false;
  }
}

/** Aparato que eligió el juez (guardado): por id, o por nombre si Spotify le cambió el id. */
export interface PreferredDevice { id?: string | null; name?: string | null }

/**
 * Elige el aparato: primero el que eligió el juez, después el activo, después
 * el primero. Sin esto la música iba al que Spotify tuviera activo (un
 * parlante de la casa) en vez del celular del juez.
 */
export function pickDevice(ds: Device[], preferred?: PreferredDevice): Device | undefined {
  return (preferred?.id ? ds.find((x) => x.id === preferred.id) : undefined)
    ?? (preferred?.name ? ds.find((x) => x.name === preferred.name) : undefined)
    ?? ds.find((x) => x.is_active) ?? ds[0];
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
  private preferred?: PreferredDevice;

  constructor(device?: Device, preferred?: PreferredDevice) {
    this.device = device;
    this.deviceId = device?.id;
    this.preferred = device ? { id: device.id, name: device.name } : preferred;
  }

  /** Nombre del aparato donde suena, para mostrarlo en pantalla. */
  get deviceName() {
    return this.device?.name;
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
      const d = pickDevice(await devices(), this.preferred);
      if (!d) throw new Error('Abrí la app de Spotify en algún dispositivo y volvé a intentar.');
      this.setDevice(d);
    }
    this.ready = true;
    this.onStatus?.(`Suena en: ${this.device?.name}`);
  }

  /**
   * Manda reproducir en el dispositivo elegido. Si Spotify ya no lo
   * encuentra (la app se cerró o cambió de id), busca de nuevo: el activo,
   * o el de mismo nombre, o el primero, y reintenta una vez.
   */
  private async startPlayback(uri: string, startMs: number, op: Op) {
    try {
      await op.wait(playUri(this.deviceId, uri, startMs));
    } catch (e) {
      if (!isDeviceNotFound(e)) throw e;
      const ds = await op.wait(devices());
      // El mismo aparato con otro id antes que el activo: no saltar a otro parlante.
      const d = pickDevice(ds.filter((x) => x.id !== this.deviceId), { name: this.device?.name ?? this.preferred?.name });
      if (!d) throw new Error('Spotify no encuentra ningún dispositivo (Device not found). Abrí la app de Spotify en el celular o la compu y tocá "Reactivar".');
      this.setDevice(d);
      this.onStatus?.(`Suena en: ${d.name}`);
      await op.wait(playUri(this.deviceId, uri, startMs));
    }
  }

  async play(uri: string, startMs: number, maxMs?: number) {
    const op = this.runner.begin();
    await runSnippet(async () => {
      await this.startPlayback(uri, startMs, op);
      if (!maxMs) return;
      await op.sleep(maxMs);
      await pauseRemote(this.deviceId);
    });
  }

  /**
   * Spotify acepta la orden aunque el aparato no la cumpla: en iPhone, la app
   * de Spotify en pausa y en segundo plano se duerme y no suena nada, sin
   * error. Preguntamos qué está sonando hasta ver este tema en este aparato.
   */
  private async waitRemotePlaying(uri: string, op: Op): Promise<PlaybackState | null> {
    for (let i = 0; i < CONNECT_CONFIRM_TRIES; i++) {
      const s = await op.wait(playbackState().catch(() => null));
      const sameTrack = !!s && (s.uri === uri || s.linkedFromUri === uri);
      if (s?.isPlaying && sameTrack && (!s.deviceId || s.deviceId === this.deviceId)) return s;
      await op.sleep(CONNECT_CONFIRM_EVERY_MS);
    }
    return null;
  }

  playSnippet(uri: string, startMs: number, lenMs: number) {
    const op = this.runner.begin();
    return runSnippet(async () => {
      const t0 = performance.now();
      await this.startPlayback(uri, startMs, op);
      this.lastPlayLatency = performance.now() - t0;
      // El fragmento se cuenta desde que el aparato de verdad suena, no desde
      // la orden: si no, con la demora de Connect un fragmento corto se
      // pausaba antes de oírse.
      const s = await this.waitRemotePlaying(uri, op);
      if (!s) {
        try { await pauseRemote(this.deviceId); } catch { /* por si arranca tarde */ }
        throw new Error(`Spotify aceptó la orden pero en «${this.device?.name ?? 'el aparato'}» no empezó a sonar. `
          + 'Si es este iPhone: Spotify se duerme cuando queda en pausa en segundo plano. Abrí la app de Spotify, dejá un tema sonando, volvé y tocá Sonar. '
          + 'Más firme: elegí un parlante (Echo, compu) en «Reproductor y conexión».');
      }
      // Visible en «Reproductor y conexión»: sirve para saber qué dice Spotify cuando no se oye nada.
      this.onStatus?.(`Suena en: ${this.device?.name} · Spotify confirmó el último fragmento (${new Date().toLocaleTimeString('es-AR')})`);
      const elapsed = Math.max(0, s.progressMs - startMs);
      // Suponemos que el pause tarda parecido al play: lo mandamos antes.
      await op.sleep(Math.max(0, lenMs - elapsed - this.lastPlayLatency * 0.5));
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
