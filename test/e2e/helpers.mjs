// Ayudas compartidas por las pruebas E2E. Todo en modo "música manual":
// ninguna prueba E2E usa Spotify real.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

export const BASE = process.env.BASE ?? 'http://127.0.0.1:8791';

/**
 * Navegador para las pruebas. Por defecto el Chromium de Playwright;
 * PW_CHANNEL=msedge (o chrome) usa el navegador instalado, y
 * PW_EXECUTABLE apunta a un binario concreto.
 */
export function launch() {
  const opts = { args: ['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.PW_CHANNEL) opts.channel = process.env.PW_CHANNEL;
  if (process.env.PW_EXECUTABLE) opts.executablePath = process.env.PW_EXECUTABLE;
  return chromium.launch(opts);
}

/** Abre el panel del juez en música manual y devuelve la página y el código de sala. */
export async function openJudge(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/juez`);
  await page.getByText('1 · Spotify').click();
  await page.getByLabel(/Sin reproductor/).check();
  await page.getByRole('button', { name: 'Activar reproductor' }).click();
  await page.getByText('Sin reproductor: la música la ponés vos').first().waitFor();
  await page.getByText(/2 · Jugadores/).click();
  const room = (await page.locator('.code').first().textContent()).trim();
  assert.match(room, /^[A-Z]{4}$/);
  return { ctx, page, room, errors };
}

export async function addTablePlayers(page, names) {
  await page.getByText(/2 · Jugadores/).click();
  for (const n of names) {
    await page.getByPlaceholder('Nombre').fill(n);
    await page.getByRole('button', { name: 'Agregar' }).click();
  }
}

export async function addTracks(page, names) {
  await page.getByText(/3 · Canciones/).click();
  for (const n of names) {
    await page.getByPlaceholder('Canción', { exact: true }).fill(n);
    await page.getByPlaceholder('Artista', { exact: true }).fill(`Artista de ${n}`);
    await page.getByRole('button', { name: '＋' }).first().click();
  }
}

/** Duraciones de las pasadas, en segundos, p. ej. '3, 8'. */
export async function setSteps(page, text) {
  await page.getByText('4 · Reglas').click();
  const input = page.getByPlaceholder('0.4, 1.2, 3, 8');
  await input.fill(text);
  await input.blur();
}

export async function start(page) {
  await page.getByRole('button', { name: '¡Empezar!' }).click();
  await page.locator('.stage').waitFor();
}

/** Abre un pulsador de celular y espera a que el juez lo acepte. */
export async function openPlayer(browser, room, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/jugar?sala=${room}`);
  await page.getByLabel('Tu nombre').fill(name);
  await page.getByRole('button', { name: 'Entrar' }).click();
  return { ctx, page, errors };
}

/** Abre la pantalla de TV de la sala. */
export async function openTV(browser, room) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/#/tv?sala=${room}`);
  await page.getByRole('button', { name: 'Activar pantalla' }).click();
  return { ctx, page, errors };
}

/** Acepta automáticamente los confirm() del juez. */
export function acceptDialogs(page) {
  page.on('dialog', (d) => d.accept());
}

/** Estado completo de la partida tal como lo guarda el juez. */
export function gameState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('en1nota.game') ?? 'null'));
}

export const phaseLabel = (page) => page.locator('.stage .phase').textContent();

/** Espera hasta que `fn` devuelva algo verdadero, o falla con `msg`. */
export async function until(fn, msg, timeout = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`Tiempo agotado: ${msg}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
