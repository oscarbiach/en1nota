import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8791';
import { mkdirSync } from 'node:fs';
mkdirSync('test/e2e/out', { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const log = (...a) => console.log('[e2e]', ...a);
try {
  // ---- juez ----
  const judgeCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const judge = await judgeCtx.newPage();
  judge.on('pageerror', (e) => console.log('JUDGE ERROR', e.message));
  await judge.goto(`${BASE}/#/juez`);
  await judge.getByText('1 · Spotify').click();
  await judge.getByLabel(/Sin reproductor/).check();
  await judge.getByRole('button', { name: 'Activar reproductor' }).click();
  await judge.getByText('Sin reproductor: la música la ponés vos').waitFor();
  log('reproductor manual activo');

  await judge.getByText(/2 · Jugadores/).click();
  const room = (await judge.locator('.code').first().textContent()).trim();
  log('sala', room);
  if (!/^[A-Z]{4}$/.test(room)) throw new Error('sin código de sala');
  await judge.getByPlaceholder('Nombre').fill('Ana');
  await judge.getByRole('button', { name: 'Agregar' }).click();
  await judge.getByText('⌨️ tecla 1').waitFor();

  // ---- jugador ----
  const playerCtx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const player = await playerCtx.newPage();
  player.on('pageerror', (e) => console.log('PLAYER ERROR', e.message));
  await player.goto(`${BASE}/#/jugar?sala=${room}`);
  await player.getByLabel('Tu nombre').fill('Beto');
  await player.getByRole('button', { name: 'Entrar' }).click();
  await player.getByText('Esperando que arranque la partida').waitFor();
  await judge.getByText('📱 celu').waitFor();
  log('jugador Beto conectado');

  // ---- TV ----
  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const tv = await tvCtx.newPage();
  tv.on('pageerror', (e) => console.log('TV ERROR', e.message));
  await tv.goto(`${BASE}/#/tv?sala=${room}`);
  await tv.getByRole('button', { name: 'Activar pantalla' }).click();
  await tv.getByText('Sumate con tu celu').waitFor();
  await tv.locator('.qr img').waitFor();
  log('TV muestra QR y código');

  // ---- canciones ----
  await judge.getByText(/3 · Canciones/).click();
  for (const [n, a] of [['Tema Uno', 'Artista A'], ['Tema Dos', 'Artista B']]) {
    await judge.getByPlaceholder('Canción', { exact: true }).fill(n);
    await judge.getByPlaceholder('Artista', { exact: true }).fill(a);
    await judge.getByRole('button', { name: '＋' }).first().click();
  }
  await judge.getByText('Lista de la partida (2)').waitFor();

  await judge.getByRole('button', { name: '¡Empezar!' }).click();
  await judge.getByText('Tema 1 / 2').waitFor();
  await player.getByText('Atenti').waitFor();
  await tv.getByText('Tema 1 / 2').waitFor();
  log('partida empezada');

  // El título no debe viajar a jugadores/TV antes de revelar.
  const tvHtml = await tv.content();
  if (tvHtml.includes('Tema Uno')) throw new Error('la TV ve el título antes de revelar');

  // ---- ronda 1: Beto toca desde el celu y acierta ----
  await judge.getByRole('button', { name: /Sonar 400 ms/ }).click();
  await player.getByText('¡TOCÁ!').waitFor();
  await player.locator('.bigbtn').dispatchEvent('pointerdown');
  await judge.locator('.floorname').getByText('Beto').waitFor();
  await tv.getByText('tiene la palabra').waitFor();
  await player.getByText('¡Tuya!').waitFor();
  log('Beto tiene la palabra');
  await judge.screenshot({ path: 'test/e2e/out/judge-buzzed.png' });
  await player.screenshot({ path: 'test/e2e/out/player-buzzed.png' });
  await tv.screenshot({ path: 'test/e2e/out/tv-buzzed.png' });
  await judge.getByRole('button', { name: /Correcto/ }).click();
  await judge.getByText('¡Beto acertó! +1').waitFor();
  await tv.getByText('Tema Uno').waitFor();
  await tv.getByText('La sacó Beto').waitFor();
  await player.getByText('¡La sacaste!').waitFor();
  log('ronda 1 ok, revelada en TV y celu');
  await judge.getByRole('button', { name: /Siguiente tema/ }).click();

  // ---- ronda 2: modo mesa con tecla 1 (Ana), falla, más largo, nadie ----
  await judge.getByText('Tema 2 / 2').waitFor();
  await judge.getByRole('button', { name: /Sonar 400 ms/ }).click();
  await judge.waitForTimeout(500); // termina el fragmento manual
  await judge.getByText('Pulsadores abiertos').waitFor();
  await judge.keyboard.press('1');
  await judge.locator('.floorname').getByText('Ana').waitFor();
  await judge.keyboard.press('x');
  await judge.getByText('Ana falló (-1)').waitFor();
  const anaPad = judge.locator('.pad', { hasText: 'Ana' });
  if (!(await anaPad.isDisabled())) throw new Error('Ana debería estar bloqueada');
  await judge.getByRole('button', { name: /Más largo/ }).click();
  await judge.getByRole('button', { name: /Sonar 1.2 s/ }).waitFor();
  // Beto puede tocar todavía y también falla
  await judge.getByRole('button', { name: /Sonar 1.2 s/ }).click();
  await player.getByText('¡TOCÁ!').waitFor();
  await player.locator('.bigbtn').dispatchEvent('pointerdown');
  await judge.locator('.floorname').getByText('Beto').waitFor();
  await judge.getByRole('button', { name: /Tarareó/ }).click();
  await judge.getByText('Beto tarareó (-1)').waitFor();
  await player.getByText('Bloqueado').waitFor();
  await judge.getByRole('button', { name: 'Revelar (nadie)' }).click();
  await judge.getByText('Nadie la sacó').waitFor();
  await judge.getByRole('button', { name: 'Terminar partida' }).first().click();

  // ---- fin ----
  await judge.getByText('Fin de la partida').waitFor();
  await tv.locator('.huge', { hasText: '🏆 Beto' }).waitFor();
  await tv.getByText('Tarareador').waitFor();
  const scores = await tv.locator('.podium .p').allTextContents();
  log('podio TV:', scores.map((s) => s.replace(/\s+/g, ' ')).join(' | '));
  if (!scores.some((s) => s.includes('Beto') && s.includes('0')) || !scores.some((s) => s.includes('Ana') && s.includes('-1'))) throw new Error('puntajes finales incorrectos');

  // historial
  await judge.getByRole('button', { name: 'Ver historial' }).click();
  await judge.getByText('Ranking histórico').waitFor();
  await judge.getByText('nadie la sacó · 2 fallos').waitFor();
  log('historial ok');

  await judge.screenshot({ path: 'test/e2e/out/judge-final.png' });
  console.log('E2E OK');
} catch (e) {
  console.log('E2E FAIL', e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
