// Regresión B08 (segunda auditoría): un fallo transitorio al renovar el
// acceso no borra la sesión; un rechazo definitivo sí. Tokens ficticios y
// fetch simulado: nunca se contacta a Spotify.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };

const { getAccessToken, isLoggedIn } = await import('../src/spotify/auth.ts');

const KEY = 'en1nota.spotify.token';
beforeEach(() => {
  mem.clear();
  mem.set(KEY, JSON.stringify({ accessToken: 'VIEJO', refreshToken: 'REFRESH-FICTICIO', expiresAt: Date.now() - 1 }));
});

async function attempt() {
  try { return { token: await getAccessToken() }; } catch (e) { return { error: (e as Error).message }; }
}

test('B08: sin conexión al renovar, la sesión se conserva', async () => {
  g.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const r = await attempt();
  assert.ok(r.error);
  assert.doesNotMatch(r.error!, /sesión/, 'el mensaje no dispara un cierre de sesión en la interfaz');
  assert.ok(mem.has(KEY), 'se conserva el refresh token');
  assert.equal(isLoggedIn(), true);
});

test('B08: Spotify caído (5xx) o limitando (429) tampoco borra la sesión', async () => {
  for (const status of [500, 503, 429]) {
    g.fetch = async () => new Response('{}', { status });
    const r = await attempt();
    assert.ok(r.error, `status ${status}`);
    assert.ok(mem.has(KEY), `status ${status}`);
  }
});

test('B08: tras volver la conexión, la renovación funciona con el mismo refresh token', async () => {
  g.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await attempt();
  let sent = '';
  g.fetch = async (_u: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ access_token: 'NUEVO', expires_in: 3600 }), { status: 200 });
  };
  assert.deepEqual(await attempt(), { token: 'NUEVO' });
  assert.match(sent, /refresh_token=REFRESH-FICTICIO/);
  assert.equal(JSON.parse(mem.get(KEY)!).refreshToken, 'REFRESH-FICTICIO', 'se conserva si Spotify no manda uno nuevo');
});

test('B08: un rechazo definitivo (invalid_grant) sí cierra la sesión', async () => {
  g.fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  const r = await attempt();
  assert.match(r.error!, /sesión de Spotify/);
  assert.equal(mem.has(KEY), false);
  assert.equal(isLoggedIn(), false);
});

test('una respuesta rara de Spotify (sin access_token) no guarda una sesión rota', async () => {
  g.fetch = async () => new Response(JSON.stringify({ token_type: 'Bearer' }), { status: 200 });
  const r = await attempt();
  assert.ok(r.error, 'avisa en vez de devolver un token vacío');
  assert.equal(JSON.parse(mem.get(KEY)!).refreshToken, 'REFRESH-FICTICIO', 'la sesión anterior queda como estaba');
});
