// Playlists de otras personas vía la página pública embed de Spotify.
// Páginas sintéticas servidas localmente: no se contacta a Spotify. Como el
// formato real no es una interfaz pública, se prueban varias formas posibles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { parseEmbed } from '../server/spotify-embed.js';

const id = (c) => c.repeat(22);
const PL = id('P');

/** Formato tipo Next.js: __NEXT_DATA__ con trackList (title/subtitle/duration). */
function nextDataPage() {
  const data = { props: { pageProps: { state: { data: { entity: {
    type: 'playlist', name: 'Cumbia de la buena', uri: `spotify:playlist:${PL}`,
    trackList: [
      { uri: `spotify:track:${id('a')}`, title: 'Primera', subtitle: 'Banda Uno, Banda Dos', duration: 201000, isPlayable: true },
      { uri: `spotify:episode:${id('e')}`, title: 'Un podcast', subtitle: 'Alguien', duration: 1000 },
      { uri: `spotify:track:${id('b')}`, title: 'Segunda', subtitle: 'Banda Tres', duration: 180000, isPlayable: true },
      { uri: `spotify:track:${id('a')}`, title: 'Primera', subtitle: 'Banda Uno', duration: 201000 },
      { uri: `spotify:track:${id('x')}`, title: 'No disponible', subtitle: 'X', duration: 1, isPlayable: false }
    ]
  } } } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

/** Formato viejo: JSON en base64 dentro de <script id="resource">, con artists[].name. */
function resourcePage() {
  const data = { name: 'Rock nacional', uri: `spotify:playlist:${PL}`, tracks: { items: [
    { track: { uri: `spotify:track:${id('c')}`, name: 'Tercera', artists: [{ name: 'Grupo' }], duration_ms: 240000 } }
  ] } };
  return `<html><script id="resource" type="text/plain">${Buffer.from(JSON.stringify(data)).toString('base64')}</script></html>`;
}

test('lee canciones del formato __NEXT_DATA__: sin episodios, repetidos ni no disponibles', () => {
  const r = parseEmbed(nextDataPage());
  assert.equal(r.name, 'Cumbia de la buena');
  assert.deepEqual(r.tracks, [
    { id: id('a'), uri: `spotify:track:${id('a')}`, name: 'Primera', artists: 'Banda Uno, Banda Dos', durationMs: 201000 },
    { id: id('b'), uri: `spotify:track:${id('b')}`, name: 'Segunda', artists: 'Banda Tres', durationMs: 180000 }
  ]);
});

test('lee el formato viejo en base64 con artists[].name y duration_ms', () => {
  const r = parseEmbed(resourcePage());
  assert.equal(r.name, 'Rock nacional');
  assert.deepEqual(r.tracks.map((t) => [t.name, t.artists, t.durationMs]), [['Tercera', 'Grupo', 240000]]);
});

test('una página sin datos reconocibles devuelve cero canciones sin romper', () => {
  assert.deepEqual(parseEmbed('<html><script>window.x = 1</script><script type="application/json">{roto</script></html>'), { name: '', tracks: [] });
});

// ---------- endpoint del servidor ----------

async function withServers(fn) {
  let upstreamHits = 0;
  const upstream = http.createServer((req, res) => {
    upstreamHits++;
    if (req.url === `/embed/playlist/${PL}`) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(nextDataPage()); return; }
    if (req.url === `/embed/playlist/${id('V')}`) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html></html>'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const port = 9300 + Math.floor(Math.random() * 90);
  const proc = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), SPOTIFY_EMBED_BASE: `http://127.0.0.1:${upstream.address().port}` },
    stdio: ['ignore', 'pipe', 'ignore']
  });
  await new Promise((r) => proc.stdout.on('data', (d) => d.toString().includes('escuchando') && r()));
  try {
    await fn({ base: `http://127.0.0.1:${port}`, hits: () => upstreamHits });
  } finally {
    proc.kill();
    upstream.close();
  }
}

test('GET /api/spotify/playlist/:id devuelve las canciones y usa caché', async () => {
  await withServers(async ({ base, hits }) => {
    const r = await fetch(`${base}/api/spotify/playlist/${PL}`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.tracks.length, 2);
    assert.equal(j.name, 'Cumbia de la buena');
    await fetch(`${base}/api/spotify/playlist/${PL}`);
    assert.equal(hits(), 1, 'la segunda vez sale de la caché');
  });
});

test('GET /api/spotify/playlist/:id valida el id y explica los fallos', async () => {
  await withServers(async ({ base }) => {
    assert.equal((await fetch(`${base}/api/spotify/playlist/no-valido`)).status, 400);
    assert.equal((await fetch(`${base}/api/spotify/playlist/${id('Z')}`)).status, 502, 'Spotify no la encontró');
    const empty = await fetch(`${base}/api/spotify/playlist/${id('V')}`);
    assert.equal(empty.status, 404);
    assert.equal((await empty.json()).error, 'sin_canciones');
  });
});
