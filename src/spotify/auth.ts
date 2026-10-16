// Login con Spotify usando Authorization Code + PKCE. Todo del lado del cliente:
// no hace falta client secret, solo el Client ID de una app creada en
// https://developer.spotify.com/dashboard con este origen como Redirect URI.
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ');

const KEY_CLIENT = 'en1nota.spotify.clientId';
const KEY_TOKEN = 'en1nota.spotify.token';
const KEY_VERIFIER = 'en1nota.spotify.verifier';
const KEY_RETURN = 'en1nota.spotify.return';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export function getClientId(): string {
  return localStorage.getItem(KEY_CLIENT) ?? '';
}
export function setClientId(id: string) {
  localStorage.setItem(KEY_CLIENT, id.trim());
}

export function redirectUri(): string {
  // Spotify exige HTTPS salvo loopback (127.0.0.1). Usamos la raíz del sitio.
  return `${location.origin}/`;
}

function loadToken(): TokenSet | null {
  try {
    const raw = localStorage.getItem(KEY_TOKEN);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch {
    return null;
  }
}
function saveToken(t: TokenSet | null) {
  if (t) localStorage.setItem(KEY_TOKEN, JSON.stringify(t));
  else localStorage.removeItem(KEY_TOKEN);
}

export function isLoggedIn(): boolean {
  return !!loadToken();
}

export function logout() {
  saveToken(null);
}

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function beginLogin(returnHash = location.hash) {
  const clientId = getClientId();
  if (!clientId) throw new Error('Falta el Client ID de Spotify');
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = b64url(verifierBytes.buffer);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(KEY_VERIFIER, verifier);
  sessionStorage.setItem(KEY_RETURN, returnHash);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge
  }).toString();
  location.assign(url.toString());
}

/** Rechazo del servidor de cuentas de Spotify, con su código HTTP. */
class TokenError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  // Con una red mala, el pedido del token no puede dejar esperando al reproductor.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getClientId(), ...body }),
    signal: abort.signal
  }).catch(() => {
    throw new Error('No se pudo renovar la sesión de Spotify (sin respuesta). Revisá la conexión a internet.');
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new TokenError(res.status, `Spotify token: ${res.status} ${await res.text()}`);
  const j = await res.json();
  const prev = loadToken();
  const t: TokenSet = {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? prev?.refreshToken,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000
  };
  saveToken(t);
  return t;
}

/** Si volvimos del login de Spotify con ?code=, canjea el código. Devuelve el hash al que volver. */
export async function completeLoginIfNeeded(): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;
  const back = sessionStorage.getItem(KEY_RETURN) || '#/juez';
  history.replaceState(null, '', location.pathname + back);
  if (error) throw new Error(`Spotify rechazó el login: ${error}`);
  const verifier = sessionStorage.getItem(KEY_VERIFIER);
  if (!verifier) throw new Error('Se perdió el verificador PKCE; probá loguearte de nuevo.');
  sessionStorage.removeItem(KEY_VERIFIER);
  await tokenRequest({ grant_type: 'authorization_code', code: code!, redirect_uri: redirectUri(), code_verifier: verifier });
  return back;
}

let refreshing: Promise<TokenSet> | null = null;

export async function getAccessToken(): Promise<string> {
  const t = loadToken();
  if (!t) throw new Error('No hay sesión de Spotify');
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) {
    saveToken(null);
    throw new Error('La sesión de Spotify venció');
  }
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken }).finally(() => (refreshing = null));
  try {
    return (await refreshing).accessToken;
  } catch (e) {
    // B08: sólo un rechazo de las credenciales (400/401, p. ej. invalid_grant)
    // cierra la sesión. Sin red, Spotify caído (5xx) o limitando (429) es
    // transitorio: se conserva el refresh token para reintentar.
    if (e instanceof TokenError && (e.status === 400 || e.status === 401)) {
      saveToken(null);
      throw new Error('La sesión de Spotify venció o se revocó: conectá de nuevo.');
    }
    throw new Error('No se pudo renovar el acceso a Spotify (sin conexión o Spotify no responde). Reintentá en un momento.');
  }
}
