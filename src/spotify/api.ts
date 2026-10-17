import { getAccessToken } from './auth.ts';
import type { Track } from '../game/types.ts';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Ninguna consulta a Spotify espera más que esto: una red mala no traba el juego. */
const TIMEOUT_MS = 10_000;
/** Si Spotify pide esperar más que esto, se avisa en vez de esperar callados. */
const MAX_RETRY_WAIT_MS = 5_000;

export async function api<T = unknown>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getAccessToken();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path.startsWith('http') ? path : BASE + path, {
      ...init,
      signal: abort.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    });
  } catch {
    throw new SpotifyError(0, abort.signal.aborted
      ? 'Spotify no respondió a tiempo. Revisá la conexión a internet y probá de nuevo.'
      : 'No hay conexión con Spotify. Revisá la conexión a internet y probá de nuevo.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') ?? 1) * 1000;
    if (retry && wait <= MAX_RETRY_WAIT_MS) {
      await new Promise((r) => setTimeout(r, wait));
      return api<T>(path, init, false);
    }
    const s = Math.ceil(wait / 1000);
    throw new SpotifyError(429, `Spotify pide esperar ${s >= 120 ? `${Math.ceil(s / 60)} minutos` : `${s} segundos`} por demasiadas consultas seguidas. Mientras tanto podés seguir con música manual.`);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j?.error?.message ?? msg;
    } catch { /* sin cuerpo */ }
    if (res.status === 401) msg = 'La sesión de Spotify venció. Salí y volvé a conectar.';
    throw new SpotifyError(res.status, msg);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface ApiTrack {
  /** 'track' o 'episode': una playlist puede tener los dos. */
  type?: string;
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  is_local?: boolean;
  artists?: Array<{ name: string }>;
  album?: { name: string; images: Array<{ url: string; width: number }> };
}

/**
 * Lo que llega de Spotify se revisa antes de usarlo: una playlist puede traer
 * ítems nulos (temas retirados), episodios o archivos locales.
 */
export function isSong(t: unknown): t is ApiTrack {
  if (typeof t !== 'object' || t === null) return false;
  const o = t as Record<string, unknown>;
  return (o.type ?? 'track') === 'track' && o.is_local !== true
    && typeof o.id === 'string' && typeof o.uri === 'string' && typeof o.name === 'string';
}

export function toTrack(t: ApiTrack): Track {
  const img = [...(t.album?.images ?? [])].sort((a, b) => a.width - b.width).find((i) => i.width >= 250) ?? t.album?.images?.[0];
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists ?? []).map((a) => a.name).join(', '),
    album: t.album?.name ?? '',
    image: img?.url,
    durationMs: t.duration_ms,
    startMs: 0
  };
}

export interface Me {
  id: string;
  display_name: string;
  product: string; // 'premium' | 'free' | ...
  images?: Array<{ url: string }>;
}

export const getMe = () => api<Me>('/me');

const isInvalidLimit = (e: unknown) => e instanceof SpotifyError && e.status === 400 && /limit/i.test(e.message);

/** Spotify cambia los topes de `limit` para apps nuevas: si rechaza el nuestro, reintenta sin mandarlo. */
async function withLimitFallback<T>(build: (limit?: number) => string, limit: number): Promise<T> {
  try {
    return await api<T>(build(limit));
  } catch (e) {
    if (!isInvalidLimit(e)) throw e;
    return api<T>(build(undefined));
  }
}

export async function searchTracks(q: string, limit = 10): Promise<Track[]> {
  const j = await withLimitFallback<{ tracks: { items: ApiTrack[] } }>((l) => {
    const p = new URLSearchParams({ q, type: 'track' });
    if (l) p.set('limit', String(l));
    return `/search?${p}`;
  }, limit);
  return (j?.tracks?.items ?? []).filter(isSong).map(toTrack);
}

export interface PlaylistSummary {
  id: string;
  name: string;
  total: number;
  image?: string;
}

export async function myPlaylists(): Promise<PlaylistSummary[]> {
  const out: PlaylistSummary[] = [];
  let url: string | null = '/me/playlists?limit=50';
  while (url) {
    const j: { items: Array<{ id: string; name: string; tracks: { total: number }; images: Array<{ url: string }> | null }>; next: string | null } = await api(url);
    // Spotify a veces devuelve playlists nulas (borradas o sin acceso).
    for (const p of j.items ?? []) {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue;
      out.push({ id: p.id, name: p.name, total: typeof p.tracks?.total === 'number' ? p.tracks.total : 0, image: p.images?.[0]?.url });
    }
    url = j.next;
  }
  return out;
}

export function parsePlaylistId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/playlist[/:]([A-Za-z0-9]{16,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9]{16,}$/.test(s)) return s;
  return null;
}

const TRACK_FIELDS = 'type,id,uri,name,duration_ms,is_local,artists(name),album(name,images)';

type ItemsPage = { items: Array<{ item?: ApiTrack | null; track?: ApiTrack | null }>; next: string | null };

/**
 * Desde la migración de febrero 2026 las apps en modo desarrollo usan
 * /playlists/{id}/items (antes /tracks) y solo pueden leer playlists creadas
 * por el mismo usuario o donde colabora. Probamos el endpoint nuevo y, si el
 * servidor todavía es viejo, el anterior.
 */
/**
 * Playlist pública de cualquier usuario, leída por el servidor desde la
 * página embed de Spotify (server/spotify-embed.js). No es una vía oficial:
 * puede dejar de funcionar si Spotify cambia esa página. Sin tapas de discos.
 */
export async function publicPlaylist(playlistId: string, apiStatus = 0): Promise<Track[]> {
  let res: Response;
  try {
    res = await fetch(`/api/spotify/playlist/${encodeURIComponent(playlistId)}`);
  } catch {
    throw new Error('No se pudo leer la playlist: sin conexión con el servidor del juego.');
  }
  const j = (await res.json().catch(() => ({}))) as { tracks?: unknown[]; error?: string };
  if (res.ok && Array.isArray(j.tracks)) {
    // Respuesta de nuestro servidor, que a su vez leyó una página de Spotify: se revisa igual.
    return j.tracks.flatMap((x) => {
      const t = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
      if (typeof t.id !== 'string' || typeof t.uri !== 'string' || !t.uri.startsWith('spotify:track:') || typeof t.name !== 'string') return [];
      const durationMs = typeof t.durationMs === 'number' && Number.isFinite(t.durationMs) && t.durationMs > 0 ? t.durationMs : 0;
      return [{ id: t.id, uri: t.uri, name: t.name.slice(0, 200), artists: typeof t.artists === 'string' ? t.artists.slice(0, 200) : '', album: '', durationMs, startMs: 0 }];
    });
  }
  if (j.error === 'sin_canciones') throw new Error('No se encontraron canciones: la playlist puede ser privada, estar vacía o tener sólo podcasts. Si es de otra persona, tiene que ser pública.');
  if (res.status === 429) throw new Error('Demasiadas consultas de playlists seguidas. Esperá un minuto y probá de nuevo.');
  throw new Error(`Spotify no dejó leer la playlist ${playlistId}${apiStatus ? ` (API: ${apiStatus})` : ''} y su página pública tampoco respondió. Revisá que el link sea de una playlist pública.`);
}

export async function playlistTracks(playlistId: string): Promise<{ tracks: Track[]; skipped: number; viaPublicPage?: boolean }> {
  const out: Track[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const attempts: Array<(limit?: number) => string> = [
    (l) => `/playlists/${playlistId}/items?fields=next,items(item(${TRACK_FIELDS}))${l ? `&limit=${l}` : ''}`,
    (l) => `/playlists/${playlistId}/items${l ? `?limit=${l}` : ''}`,
    (l) => `/playlists/${playlistId}/tracks?fields=next,items(track(${TRACK_FIELDS}))${l ? `&limit=${l}` : ''}`
  ];
  let page: ItemsPage | undefined;
  let lastStatus = 0;
  for (const build of attempts) {
    try {
      page = await withLimitFallback<ItemsPage>(build, 50);
      break;
    } catch (e) {
      if (!(e instanceof SpotifyError) || ![400, 403, 404].includes(e.status)) throw e;
      lastStatus = e.status;
    }
  }
  if (!page) {
    // La API oficial sólo deja leer playlists propias: probamos la página
    // pública de Spotify a través de nuestro servidor (otras personas,
    // playlists armadas por Spotify).
    const tracks = await publicPlaylist(playlistId, lastStatus);
    return { tracks, skipped: 0, viaPublicPage: true };
  }
  for (;;) {
    for (const it of page.items ?? []) {
      // B05: sólo canciones de Spotify. Episodios, archivos locales, ítems
      // retirados (null) o repetidos se omiten y se cuentan.
      const t = it?.item ?? it?.track;
      if (!isSong(t) || seen.has(t.uri)) { skipped++; continue; }
      seen.add(t.uri);
      out.push(toTrack(t));
    }
    if (!page.next) break;
    page = await api<ItemsPage>(page.next);
  }
  return { tracks: out, skipped };
}

// ---------- reproducción (Spotify Connect) ----------

export interface Device {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

export async function devices(): Promise<Device[]> {
  const j = await api<{ devices: Device[] }>('/me/player/devices');
  return j.devices;
}

export async function transferTo(deviceId: string, play = false) {
  await api('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play }) });
}

export async function playUri(deviceId: string | undefined, uri: string, positionMs: number) {
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  await api(`/me/player/play${q}`, { method: 'PUT', body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.floor(positionMs)) }) });
}

export async function pauseRemote(deviceId?: string) {
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  try {
    await api(`/me/player/pause${q}`, { method: 'PUT' });
  } catch (e) {
    // 403 "Player command failed: Restriction violated" = ya estaba pausado.
    if (!(e instanceof SpotifyError && e.status === 403)) throw e;
  }
}
