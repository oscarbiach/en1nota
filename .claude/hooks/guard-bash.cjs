// PreToolUse (Bash): frena comandos destructivos antes de que corran y pide
// confirmación para lo que toca producción (Render).
const fs = require('node:fs');
let input; try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const cmd = String((input.tool_input && input.tool_input.command) || '');

const decide = (permissionDecision, permissionDecisionReason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason } }));
  process.exit(0);
};

// Solo cuenta en posición de comando (inicio de línea o tras ; & | ( $( ),
// para no frenar un mensaje de commit que nombra estos comandos.
const ORDEN = String.raw`(?:^|[;&|(\n]|\$\()\s*(?:sudo\s+)?`;
const regla = (cuerpo, flags = '') => new RegExp(ORDEN + cuerpo, 'm' + flags);
const BLOQUEAR = [
  [regla(String.raw`git\b[^\n;&|]*\bpush\b[^\n;&|]*(\s--force(?!-with-lease)\b|\s-f\b)`), 'git push --force reescribe la historia publicada (Render despliega desde esa rama)'],
  [regla(String.raw`git\b[^\n;&|]*\bpush\b[^\n;&|]*--no-verify\b`), 'git push --no-verify saltea los controles'],
  [regla(String.raw`git\s+reset\b[^\n;&|]*--hard\b`), 'git reset --hard descarta cambios sin respaldo'],
  [regla(String.raw`git\s+clean\b[^\n;&|]*\s-[a-z]*f`, 'i'), 'git clean -f borra archivos sin respaldo'],
  [regla(String.raw`git\s+(checkout|restore)\s+(--\s+)?\.(\s|$)`), 'descarta todos los cambios sin guardar'],
  [regla(String.raw`git\s+remote\s+(add|remove|rm|set-url|rename)\b`), 'cambiar remotos requiere autorización del dueño'],
  // pkill/pgrep -f también coinciden con la línea de comando del propio shell y lo matan.
  [regla(String.raw`(pkill|pgrep)\b[^\n;&|]*\s-f\b`), 'pkill -f / pgrep -f se matan a sí mismos en este entorno; guardá el PID al lanzar el proceso y usá kill <PID>'],
];
for (const [re, motivo] of BLOQUEAR) {
  if (re.test(cmd)) decide('deny', 'Bloqueado por la regla del proyecto: ' + motivo + '. Proponé una alternativa segura o pedile al usuario que lo haga él.');
}

// Producción = el servicio de Render. Solo el GET a /healthz pasa sin preguntar.
// Buscar el texto «onrender» en los archivos pasa; lo que sale a la red, no.
if (/onrender\.com/i.test(cmd) && /\b(curl|wget|http|nc|websocat|ab|autocannon|fetch|WebSocket)\b/.test(cmd) && !/^\s*curl\s+(-[sSfL]+\s+)*["']?https:\/\/[a-z0-9-]+\.onrender\.com\/healthz["']?\s*$/i.test(cmd)) {
  decide('ask', 'Este comando habla con producción (Render). Nada de pruebas de carga ni maliciosas contra producción; requiere confirmación del usuario.');
}
