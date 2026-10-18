// Vista previa: los 30 s de cada canción que Spotify publica en su página
// embed, tocados en un <audio> de esta misma página. Pensado para iPhone:
// Spotify Connect hacia el mismo celular no arranca (con la app de Spotify en
// segundo plano, el iPhone no la deja empezar un tema nuevo; caso real
// 2026-10-18). La pausa es local, así que 400 ms duran 400 ms. El fragmento
// arranca donde arranca la vista previa que eligió Spotify, no en el punto de
// inicio marcado en la lista.
import type { SnippetPlayer } from './snippet.ts';
import { Runner, runSnippet, type Op } from './run.ts';

const PREVIEW_MS = 30_000;
const TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;

/** 0,1 s de silencio (WAV): sonarlo desde un toque desbloquea el audio en iPhone. */
function silence(): string {
  const n = 800;
  const b = new Uint8Array(44 + n).fill(128);
  const v = new DataView(b.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

function bounded<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(t));
}

export class PreviewPlayer implements SnippetPlayer {
  readonly mode = 'preview';
  ready = false;
  deviceId = undefined;
  onStatus?: (s: string) => void;
  private runner = new Runner();
  private audio?: HTMLAudioElement;
  private urls = new Map<string, string>();

  /** Desde un toque: deja el <audio> habilitado para sonar después sin otro toque (iPhone). */
  async init() {
    this.audio ??= new Audio();
    const a = this.audio;
    a.preload = 'auto';
    if (!this.ready) {
      a.src = silence();
      try { await bounded(a.play(), 3000, 'sin desbloqueo'); } catch { /* lo reintenta el primer Sonar */ }
      a.pause();
    }
    this.ready = true;
    this.onStatus?.('Vista previa: suena en este aparato (30 s de cada tema)');
  }

  private async previewUrl(uri: string, op: Op): Promise<string> {
    const id = TRACK_URI.exec(uri)?.[1];
    if (!id) throw new Error('En Vista previa sólo suenan temas de Spotify: este fue agregado a mano.');
    const hit = this.urls.get(id);
    if (hit) return hit;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10_000);
    let res: Response;
    try {
      res = await op.wait(fetch(`/api/spotify/preview/${id}`, { signal: abort.signal }));
    } catch (e) {
      if (op.cancelled) throw e;
      throw new Error('No se pudo pedir la vista previa: sin conexión con el servidor del juego.');
    } finally {
      clearTimeout(timer);
    }
    const j = (await op.wait(res.json().catch(() => ({})))) as { url?: unknown; error?: string };
    if (res.ok && typeof j.url === 'string') { this.urls.set(id, j.url); return j.url; }
    if (j.error === 'sin_vista_previa') throw new Error('Spotify no tiene vista previa de este tema. Saltalo (Ajustes rápidos → Saltar tema) y seguí con el próximo.');
    if (res.status === 429) throw new Error('Demasiados pedidos de vista previa seguidos. Esperá un minuto.');
    throw new Error('Spotify no respondió con la vista previa. Probá de nuevo en un momento.');
  }

  /** Arranca la vista previa desde el principio; resuelve cuando ya suena. */
  private async start(uri: string, op: Op) {
    const url = await this.previewUrl(uri, op);
    const a = (this.audio ??= new Audio());
    if (a.src !== url) a.src = url;
    try { a.currentTime = 0; } catch { /* sin datos todavía: arranca en 0 igual */ }
    op.onCancel(() => a.pause());
    try {
      await op.wait(bounded(a.play(), 10_000, 'tiempo'));
    } catch (e) {
      if (op.cancelled) throw e;
      a.pause();
      throw new Error((e as Error).name === 'NotAllowedError'
        ? 'El celular no dejó sonar. Tocá «Reactivar» en Reproductor y conexión, y después Sonar.'
        : 'La vista previa no arrancó (red lenta o sin datos). Probá Sonar de nuevo.');
    }
  }

  playSnippet(uri: string, _startMs: number, lenMs: number) {
    const op = this.runner.begin();
    return runSnippet(async () => {
      await this.start(uri, op);
      await op.sleep(Math.min(lenMs, PREVIEW_MS));
      this.audio?.pause();
    });
  }

  async play(uri: string, _startMs: number, maxMs?: number) {
    const op = this.runner.begin();
    await runSnippet(async () => {
      await this.start(uri, op);
      await op.sleep(Math.min(maxMs ?? PREVIEW_MS, PREVIEW_MS));
      this.audio?.pause();
    });
  }

  async stop() {
    this.runner.cancel();
    this.audio?.pause();
  }

  destroy() {
    this.runner.cancel();
    this.audio?.pause();
    this.ready = false;
  }
}
