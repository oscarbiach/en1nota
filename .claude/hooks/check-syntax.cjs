// PostToolUse (Edit/Write): sintaxis del archivo editado al instante.
// JavaScript con node --check; TypeScript con tsc, mirando solo errores de
// sintaxis (TS1xxx) del archivo editado: en un cambio de varios archivos los
// errores de tipos a mitad de camino son normales y los revisa la validación.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
let input; try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const t = input.tool_input || {};
if (typeof t.file_path !== 'string') process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const file = path.resolve(input.cwd || process.cwd(), t.file_path);
if (!fs.existsSync(file)) process.exit(0);
const fail = (msg) => { process.stderr.write('Error de sintaxis en ' + t.file_path + ':\n' + msg.slice(0, 2000)); process.exit(2); };

if (/\.(c|m)?js$/i.test(file)) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0 && r.status !== null) fail(r.stderr || '');
} else if (/\.tsx?$/i.test(file) && (file.startsWith(path.join(root, 'src') + path.sep) || file.startsWith(path.join(root, 'test') + path.sep))) {
  const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
  if (!fs.existsSync(tsc)) process.exit(0);
  const r = spawnSync(tsc, ['--noEmit', '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const rel = path.relative(root, file).split(path.sep).join('/');
  const mine = (r.stdout || '').split('\n').filter((l) => l.replace(/\\/g, '/').startsWith(rel + '(') && /error TS1\d{3}:/.test(l));
  if (mine.length) fail(mine.join('\n'));
}
