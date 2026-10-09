// Runner E2E multiplataforma (Windows, macOS, Linux): levanta el servidor
// sobre dist/ en un puerto propio, corre la partida completa y las
// regresiones de la auditoría, y apaga el servidor pase lo que pase.
// Uso: npm run test:e2e   (compila antes). Variables opcionales:
//   E2E_PORT=8791  PW_CHANNEL=msedge  PW_EXECUTABLE=/ruta/al/navegador
import { spawn } from 'node:child_process';

const PORT = process.env.E2E_PORT ?? '8791';
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT, BASE };

const server = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => { if (d.toString().includes('escuchando')) resolve(); });
  server.on('exit', (code) => reject(new Error(`el servidor terminó (código ${code})`)));
});

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { env, stdio: 'inherit' });
    p.on('exit', (code) => resolve(code ?? 1));
  });
}

let code = 1;
try {
  await ready;
  const flow = await run(['test/e2e/flow.mjs']);
  const regressions = await run(['--test', '--test-concurrency=1', 'test/e2e/regressions.test.mjs']);
  code = flow || regressions;
} catch (e) {
  console.error(e);
} finally {
  server.kill();
}
process.exit(code);
