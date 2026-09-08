import { getAccessToken } from './auth';
import type { Track } from '../game/types';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  });
  if (res.status === 429 && retry) {
    const wait = Number(res.headers.get('Retry-After') ?? 1) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return api<T>(path, init, false);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j?.error?.message ?? msg;
    } catch { /* sin cuerpo */ }
    throw new SpotifyError(res.status, msg);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface ApiTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  is_local?: boolean;
  artists: Array<{ name: string }>;
  album: { name: string; images: Array<{ url: string; width: number }> };
}

export function toTrack(t: ApiTrack): Track {
  const img = [...(t.album?.images ?? [])].sort((a, b) => a.width - b.width).find((i) => i.width >= 250) ?? t.album?.images?.[0];
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
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

export async function searchTracks(q: string, limit = 12): Promise<Track[]> {
  const j = await api<{ tracks: { items: ApiTrack[] } }>(`/search?${new URLSearchParams({ q, type: 'track', limit: String(limit) })}`);
  return j.tracks.items.filter((t) => !t.is_local).map(toTrack);
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
    for (const p of j.items) out.push({ id: p.id, name: p.name, total: p.tracks?.total ?? 0, image: p.images?.[0]?.url });
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

export async function playlistTracks(playlistId: string): Promise<Track[]> {
  const out: Track[] = [];
  let url: string | null = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,uri,name,duration_ms,is_local,artists(name),album(name,images)))`;
  while (url) {
    const j: { items: Array<{ track: ApiTrack | null }>; next: string | null } = await api(url);
    for (const it of j.items) if (it.track && it.track.id && !it.track.is_local) out.push(toTrack(it.track));
    url = j.next;
  }
  return out;
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
