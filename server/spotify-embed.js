// Lectura de playlists públicas de cualquier usuario a partir de la página
// pública "embed" de Spotify (open.spotify.com/embed/playlist/ID), que es la
// que se usa para insertar una playlist en otros sitios y no requiere cuenta.
//
// Se usa cuando la API oficial no deja leer la playlist (desde 2026 las apps
// en modo desarrollo sólo leen playlists propias). NO es una interfaz
// oficial: Spotify puede cambiar esa página sin aviso. Por eso no se depende
// de una ruta exacta dentro de sus datos: se recorre todo el JSON embebido y
// se toman los objetos que parecen canciones (uri spotify:track:… + título).

export const PLAYLIST_ID = /^[A-Za-z0-9]{22}$/;
const TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;
const PLAYLIST_URI = /^spotify:playlist:[A-Za-z0-9]{22}$/;

/** Bloques JSON incrustados en la página: __NEXT_DATA__ / application/json y el "resource" en base64. */
function jsonBlobs(html) {
  const out = [];
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);
  for (const [, attrs, body] of scripts) {
    const text = body.trim();
    if (!text) continue;
    if (/type=["']application\/(ld\+)?json["']/i.test(attrs) || /id=["']__NEXT_DATA__["']/i.test(attrs)) {
      try { out.push(JSON.parse(text)); } catch { /* no es JSON */ }
    } else if (/id=["']resource["']/i.test(attrs)) {
      try { out.push(JSON.parse(Buffer.from(text, 'base64').toString('utf8'))); } catch { /* formato distinto */ }
    }
  }
  return out;
}

function artistsOf(o) {
  if (typeof o.subtitle === 'string') return o.subtitle.replace(/ /g, ' ');
  const list = Array.isArray(o.artists) ? o.artists : Array.isArray(o.artists?.items) ? o.artists.items : [];
  return list.map((a) => a?.name ?? a?.profile?.name).filter((n) => typeof n === 'string').join(', ');
}

function durationOf(o) {
  for (const v of [o.duration, o.duration_ms, o.durationMs, o.duration?.totalMilliseconds, o.trackDuration?.totalMilliseconds]) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

/**
 * HTML de la página embed → { name, tracks }. Canciones únicas en el orden
 * en que aparecen; episodios y otros objetos se ignoran.
 */
export function parseEmbed(html) {
  const tracks = [];
  const seen = new Set();
  let name = '';
  const visit = (node, depth) => {
    if (depth > 40 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const x of node) visit(x, depth + 1); return; }
    const uri = typeof node.uri === 'string' ? node.uri : '';
    const title = typeof node.title === 'string' ? node.title : typeof node.name === 'string' ? node.name : '';
    const m = TRACK_URI.exec(uri);
    if (m && title && node.isPlayable !== false) {
      if (!seen.has(uri)) {
        seen.add(uri);
        tracks.push({ id: m[1], uri, name: title, artists: artistsOf(node), durationMs: durationOf(node) });
      }
      return;
    }
    if (!name && PLAYLIST_URI.test(uri) && title) name = title;
    for (const v of Object.values(node)) visit(v, depth + 1);
  };
  for (const blob of jsonBlobs(html)) visit(blob, 0);
  return { name, tracks };
}

/**
 * Página embed de UNA canción (open.spotify.com/embed/track/ID) → enlace a su
 * vista previa de 30 s (MP3 en p.scdn.co), o null. Es lo que el reproductor
 * embebido de Spotify toca sin cuenta. Se busca el enlace en todo el HTML,
 * esté escrito tal cual o escapado dentro de JSON (\/ o /).
 */
export function parsePreview(html) {
  const text = String(html).replace(/\\u002[Ff]/g, '/').replace(/\\\//g, '/');
  const m = /https:\/\/p\.scdn\.co\/mp3-preview\/[A-Za-z0-9]+(?:\?[A-Za-z0-9=&%._-]*)?/.exec(text);
  return m ? m[0] : null;
}
