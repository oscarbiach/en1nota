// Regresión B05 (segunda auditoría): una playlist mixta importa las canciones
// válidas e informa lo omitido. Respuestas de Spotify simuladas; sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };
mem.set('en1nota.spotify.token', JSON.stringify({ accessToken: 'FICTICIO', expiresAt: Date.now() + 3_600_000 }));

const { api, myPlaylists, playlistTracks, publicPlaylist, searchTracks, toTrack } = await import('../src/spotify/api.ts');

const song = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'track', id, uri: `spotify:track:${id}`, name: `Canción ${id}`, duration_ms: 180_000,
  artists: [{ name: 'Artista' }], album: { name: 'Disco', images: [{ url: 'https://i/x.jpg', width: 300 }] }, ...extra
});

function serve(pages: unknown[]) {
  let i = 0;
  g.fetch = async () => new Response(JSON.stringify(pages[i++]), { status: 200 });
}

test('B05: una playlist con episodios, nulos, locales y duplicados importa sólo canciones', async () => {
  serve([
    {
      items: [
        { item: song('a') },
        { item: { type: 'episode', id: 'ep1', uri: 'spotify:episode:1', name: 'Podcast', duration_ms: 1000 } }, // caso de la auditoría
        { item: null },
        { item: song('local', { is_local: true }) },
        { item: song('a') } // duplicada
      ],
      next: 'https://api.spotify.com/v1/siguiente'
    },
    { items: [{ item: song('b', { artists: undefined, album: undefined }) }, { track: song('c') }], next: null }
  ]);
  const r = await playlistTracks('miplaylist1234567');
  assert.deepEqual(r.tracks.map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(r.skipped, 4, 'episodio, nulo, local y duplicada');
  assert.equal(r.tracks[1].artists, '', 'sin artistas no rompe');
});

test('toTrack tolera campos faltantes', () => {
  const t = toTrack({ id: 'x', uri: 'spotify:track:x', name: 'X', duration_ms: 1 } as never);
  assert.equal(t.artists, '');
  assert.equal(t.album, '');
  assert.equal(t.image, undefined);
});

test('playlist de otra persona: si la API la rechaza, se lee desde la página pública', async () => {
  const pedidos: string[] = [];
  g.fetch = async (url: string) => {
    pedidos.push(String(url));
    if (String(url).startsWith('https://api.spotify.com')) return new Response(JSON.stringify({ error: { status: 403, message: 'Forbidden' } }), { status: 403 });
    return new Response(JSON.stringify({ name: 'De Juan', tracks: [{ id: 'z'.repeat(22), uri: `spotify:track:${'z'.repeat(22)}`, name: 'Ajena', artists: 'Banda', durationMs: 200_000 }] }), { status: 200 });
  };
  const r = await playlistTracks('pqrstuvwxyzABCDEFGHIJK');
  assert.equal(r.viaPublicPage, true);
  assert.deepEqual(r.tracks.map((t) => [t.name, t.artists, t.startMs]), [['Ajena', 'Banda', 0]]);
  assert.ok(pedidos.at(-1)!.endsWith('/api/spotify/playlist/pqrstuvwxyzABCDEFGHIJK'));
});

test('playlist privada o vacía: el mensaje explica qué revisar', async () => {
  g.fetch = async (url: string) => (String(url).startsWith('https://api.spotify.com')
    ? new Response('{}', { status: 404 })
    : new Response(JSON.stringify({ error: 'sin_canciones' }), { status: 404 }));
  await assert.rejects(playlistTracks('pqrstuvwxyzABCDEFGHIJK'), /tiene que ser pública/);
});

test('si Spotify pide esperar mucho (429 con Retry-After largo), avisa en vez de quedarse esperando', async () => {
  g.fetch = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('se quedó esperando')), 2000).unref());
  await assert.rejects(Promise.race([api('/me/player/pause', { method: 'PUT' }), timeout]), /esperar/);
});

test('búsqueda y "mis playlists" con ítems nulos de Spotify no rompen', async () => {
  serve([{ tracks: { items: [null, song('a'), { type: 'episode', id: 'e', uri: 'spotify:episode:e', name: 'Pod' }, song('l', { is_local: true })] } }]);
  assert.deepEqual((await searchTracks('algo')).map((t) => t.id), ['a']);
  serve([{ items: [null, { id: 'p1', name: 'Mía', tracks: { total: 3 }, images: null }, { id: 5, name: 'rara' }], next: null }]);
  assert.deepEqual(await myPlaylists(), [{ id: 'p1', name: 'Mía', total: 3, image: undefined }]);
});

test('la playlist pública que manda el servidor se revisa: ítems mal formados quedan afuera', async () => {
  const ok = { id: 'z'.repeat(22), uri: `spotify:track:${'z'.repeat(22)}`, name: 'Buena', artists: 'Banda', durationMs: 1000 };
  g.fetch = async () => new Response(JSON.stringify({ tracks: [ok, null, { id: 'x', name: 'Sin uri' }, { ...ok, uri: 'javascript:alert(1)' }, { ...ok, artists: 7, durationMs: -5 }] }), { status: 200 });
  const r = await publicPlaylist('pqrstuvwxyzABCDEFGHIJK');
  assert.deepEqual(r.map((t) => [t.name, t.artists, t.durationMs]), [['Buena', 'Banda', 1000], ['Buena', '', 0]]);
});

test('Spotify contesta play/pausa con un texto suelto (no JSON): no es un error', async () => {
  // Caso real (2026-10-18, iPhone): "JSON Parse error: Unexpected identifier giboo9OWU2Flwq7oGo5mGqqQMf0".
  g.fetch = async () => new Response('giboo9OWU2Flwq7oGo5mGqqQMf0', { status: 200, headers: { 'content-type': 'text/plain' } });
  assert.equal(await api('/me/player/play', { method: 'PUT' }), undefined);
});
