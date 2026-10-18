// Prueba de fuego (mutaciones a mano): rompe a propósito una cosa por vez en
// un flujo crítico, corre las pruebas unitarias y restaura el archivo.
// "VIVO" = las pruebas pasaron con el código roto: ese flujo está desprotegido.
// Uso: node .claude/scripts/mutantes.mjs [parte del nombre]
// Al cambiar una de estas líneas, actualizá su texto acá (si no aparece, se avisa con ??).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const root = join(import.meta.dirname, '..', '..');
const only = process.argv[2];
const M = [
  ['gana el toque más rápido', 'src/game/engine.ts', '.sort((a, b) => a.at - b.at);\n  if (!winner) return g;', '.sort((a, b) => b.at - a.at);\n  if (!winner) return g;'],
  ['Correcto dos veces no suma dos veces', 'src/game/engine.ts', "  if (g.phase !== 'buzzed' || !pid) return g;\n  const points = pointsFor", '  const points = pointsFor'],
  ['el que falla queda bloqueado', 'src/game/engine.ts', 'const locked = g.settings.lockOnFail ?', 'const locked = !g.settings.lockOnFail ?'],
  ['puntos por pasada (tope del último valor)', 'src/game/engine.ts', 'return p[Math.min(step, p.length - 1)] ?? 1;', 'return p[step] ?? 1;'],
  ['un bloqueado no puede tocar', 'src/game/engine.ts', '  if (g.round.lockedPlayerIds.includes(playerId)) return false;\n', ''],
  ['la partida termina tras el último tema', 'src/game/engine.ts', '  if (idx >= g.tracks.length) {', '  if (idx > g.tracks.length) {'],
  ['TV/celus no ven el título antes de revelar', 'src/game/engine.ts', "const revealed = g.phase === 'revealed' && t ?", 'const revealed = t ?'],
  ['mezcla al empezar', 'src/game/engine.ts', 'tracks: g.settings.shuffleOnStart ? shuffle(g.tracks, rand) : g.tracks,', 'tracks: g.tracks,'],
  ['credencial firmada de la sala', 'server/index.js', 'return x.length === y.length && crypto.timingSafeEqual(x, y);', 'return true;'],
  ['límite de mensajes por celular', 'server/index.js', 'if (bucket.tokens >= 1) { bucket.tokens -= 1; return true; }', 'if (bucket.tokens >= 1) { return true; }'],
  ['el orden lo pone la hora de llegada al servidor', 'server/index.js', "send(entry.room.host, { t: 'msg', from: me.pid, data, at: Date.now() });", "send(entry.room.host, { t: 'msg', from: me.pid, data, at: data?.at ?? 0 });"],
  ['el token vencido se renueva', 'src/spotify/auth.ts', 'if (Date.now() < t.expiresAt) return t.accessToken;', 'return t.accessToken;'],
  ['no cargar partidas de una versión futura', 'src/storage/schema.ts', 'v.v > SCHEMA_VERSION)) return null;', 'v.v > SCHEMA_VERSION + 1)) return null;'],
  ['la pausa del SDK tiene tope', 'src/spotify/player.ts', "try { await withTimeout(this.player?.pause(), 1500, 'pause'); }", 'try { await this.player?.pause(); }'],
  ['Spotify pidiendo esperar mucho no traba', 'src/spotify/api.ts', 'if (retry && wait <= MAX_RETRY_WAIT_MS) {', 'if (retry) {'],
  ['Connect suena en el aparato elegido, no en el activo', 'src/spotify/player.ts', 'return (preferred?.id ? ds.find((x) => x.id === preferred.id) : undefined)', 'return ds.find((x) => x.is_active) ?? (preferred?.id ? ds.find((x) => x.id === preferred.id) : undefined)'],
  ['la consulta a Spotify tiene tope de tiempo', 'src/spotify/api.ts', 'const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);', 'const timer = setTimeout(() => {}, TIMEOUT_MS);'],
];
const results = [];
for (const [name, file, from, to] of M) {
  if (only && !name.includes(only)) continue;
  const path = `${root}/${file}`;
  const orig = readFileSync(path, 'utf8');
  if (orig.split(from).length !== 2) { results.push(`?? ${name}: el texto a mutar no aparece una sola vez`); continue; }
  writeFileSync(path, orig.replace(from, to));
  try {
    const r = spawnSync('node', ['--test', '--test-timeout=20000', 'test/**/*.test.{ts,js}'], { cwd: root, encoding: 'utf8', timeout: 180_000 });
    const fails = (r.stdout.match(/^# fail (\d+)/m) || [, '?'])[1];
    const killed = r.status !== 0;
    results.push(`${killed ? 'MUERTO' : 'VIVO  '} ${name} (${file}) — fallas: ${r.error ? 'tiempo agotado' : fails}`);
  } finally {
    writeFileSync(path, orig);
  }
  console.log(results.at(-1));
}
const vivos = results.filter((r) => !r.startsWith('MUERTO'));
console.log(vivos.length ? `\n${vivos.length} sin detectar o sin aplicar` : '\nTodas las roturas fueron detectadas.');
process.exitCode = vivos.length ? 1 : 0;
