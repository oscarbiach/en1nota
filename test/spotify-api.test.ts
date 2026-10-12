// Regresión B05 (segunda auditoría): una playlist mixta importa las canciones
// válidas e informa lo omitido. Respuestas de Spotify simuladas; sin red.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };
mem.set('en1nota.spotify.token', JSON.stringify({ accessToken: 'FICTICIO', expiresAt: Date.now() + 3_600_000 }));

const { playlistTracks, toTrack } = await import('../src/spotify/api.ts');

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
