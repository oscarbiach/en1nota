// Stop: si hay cambios sin guardar, corre la validación rápida; si falla,
// sale con 2 para que Claude lo corrija antes de entregar. La PWA no necesita
// subir un número de versión: vite-plugin-pwa versiona el service worker solo.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
let input = {}; try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch {}
if (input.stop_hook_active) process.exit(0); // ya intentó corregir una vez: no trabar la conversación
const raiz = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const st = spawnSync('git', ['status', '--porcelain'], { cwd: raiz, encoding: 'utf8', timeout: 8000 });
if (st.status !== 0 || !st.stdout.trim()) process.exit(0);
const r = spawnSync(process.execPath, [path.join(raiz, '.claude', 'scripts', 'validate.mjs')], { cwd: raiz, encoding: 'utf8', timeout: 60000 });
if (r.status !== 0) {
  process.stderr.write('La validación falló. Corregilo antes de terminar:\n' + ((r.stderr || '') + (r.stdout || '')).slice(-2500));
  process.exit(2);
}
