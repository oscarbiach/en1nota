// Validación rápida sin conexión (1 o 2 segundos): tipos, sintaxis del
// servidor y de las pruebas, y la configuración que Render necesita.
// Uso: node .claude/scripts/validate.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const fails = [];

const tsc = join(root, 'node_modules', '.bin', 'tsc');
if (!existsSync(tsc)) fails.push('falta node_modules: corré npm ci');
else {
  const r = spawnSync(tsc, ['--noEmit'], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) fails.push('tipos (tsc --noEmit):\n' + (r.stdout + r.stderr).trim().split('\n').slice(0, 20).join('\n'));
}

const js = (dir, re) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => re.test(f)).map((f) => join(dir, f)) : []);
for (const f of [...js('server', /\.js$/), ...js('test', /\.js$/), ...js('test/e2e', /\.mjs$/)]) {
  const r = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) fails.push(`sintaxis de ${f}:\n${r.stderr.trim().split('\n').slice(0, 6).join('\n')}`);
}

const render = existsSync(join(root, 'render.yaml')) ? readFileSync(join(root, 'render.yaml'), 'utf8') : '';
if (!/ROOM_SECRET/.test(render)) fails.push('render.yaml no define ROOM_SECRET: el servidor de producción no arrancaría con credenciales firmadas');
for (const f of ['index.html', 'server/index.js', 'src/main.tsx', 'vite.config.ts']) {
  if (!existsSync(join(root, f))) fails.push(`falta ${f}`);
}

if (fails.length) {
  process.stderr.write('validar: FALLA\n' + fails.join('\n\n') + '\n');
  process.exit(1);
}
process.stdout.write('validar: OK\n');
