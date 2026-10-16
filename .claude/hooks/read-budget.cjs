// PreToolUse (Read): los archivos de más de 1500 líneas se leen por partes.
const fs = require('node:fs'), path = require('node:path');
let input; try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const t = input.tool_input || {};
const MAX = 1500;
if (Number.isInteger(t.limit) && t.limit > 0 && t.limit <= MAX) process.exit(0);
if (typeof t.file_path !== 'string' || /\.(png|jpe?g|gif|webp|svg|ico|pdf|ipynb)$/i.test(t.file_path)) process.exit(0);
try {
  const file = path.resolve(input.cwd || process.cwd(), t.file_path);
  if (fs.statSync(file).size > 50 * 1024 * 1024) process.exit(0);
  const lines = fs.readFileSync(file, 'utf8').split('\n').length;
  if (lines > MAX) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: `Lectura extensa (${lines} líneas): usá Grep y Read con offset y limit de hasta ${MAX} líneas.` } }));
  }
} catch { /* archivo inexistente o binario: que Read informe */ }
