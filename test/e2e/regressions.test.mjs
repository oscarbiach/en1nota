// Regresiones de la auditoría en navegador real: juez, celulares y TV en
// contextos independientes, música manual (sin Spotify). Requiere el
// servidor en BASE; `npm run test:e2e` lo levanta y lo apaga.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  launch, openJudge, addTablePlayers, addTracks, setSteps, start, gameState, phaseLabel, until
} from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const sonar = (page) => page.getByRole('button', { name: /^▶ Sonar/ });

/** Juez en modo mesa con Ana y Beto, dos temas y pasadas de 3 y 8 s. */
async function tableGame() {
  const j = await openJudge(browser);
  await addTablePlayers(j.page, ['Ana', 'Beto']);
  await addTracks(j.page, ['Tema Uno', 'Tema Dos']);
  await setSteps(j.page, '3, 8');
  await start(j.page);
  return j;
}

test('A01: "Parar" durante el fragmento deja Sonar disponible', async () => {
  const { ctx, page, errors } = await tableGame();
  await sonar(page).click();
  assert.equal(await phaseLabel(page), 'Sonando…');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '■ Parar' }).click();
  await until(async () => (await phaseLabel(page)) === 'Pulsadores abiertos', 'la fase vuelve a pulsadores abiertos', 1000);
  await until(() => sonar(page).isEnabled(), 'Sonar se habilita enseguida', 1000);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('A01: tocar durante el fragmento y fallar no bloquea Sonar', async () => {
  const { ctx, page, errors } = await tableGame();
  await sonar(page).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('1'); // Ana, modo mesa
  await page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  await page.getByRole('button', { name: /Incorrecto/ }).click();
  assert.equal(await phaseLabel(page), 'Pulsadores abiertos');
  // Antes quedaba deshabilitado incluso pasados 3,2 s; ahora en menos de 1 s.
  await until(() => sonar(page).isEnabled(), 'Sonar se habilita tras el fallo', 1000);
  // Y se puede repetir: suena y termina sola.
  await sonar(page).click();
  assert.equal(await phaseLabel(page), 'Sonando…');
  await until(async () => (await phaseLabel(page)) === 'Pulsadores abiertos', 'la repetición termina', 4500);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('A01: el timer de un fragmento cancelado no corta el siguiente', async () => {
  const { ctx, page } = await tableGame();
  await sonar(page).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '■ Parar' }).click();
  await until(() => sonar(page).isEnabled(), 'Sonar disponible', 1000);
  await sonar(page).click();
  const t0 = Date.now();
  // A los ~2 s del segundo fragmento habría vencido el timer del primero.
  await page.waitForTimeout(2300);
  assert.equal(await phaseLabel(page), 'Sonando…', 'el fragmento nuevo sigue sonando');
  await until(async () => (await phaseLabel(page)) === 'Pulsadores abiertos', 'el fragmento nuevo termina a su tiempo', 2000);
  assert.ok(Date.now() - t0 >= 2900, 'no terminó antes de sus 3 s');
  await ctx.close();
});

test('A02: recargar mientras suena conserva puntajes y permite repetir', async () => {
  const { ctx, page, errors } = await tableGame();
  // Beto falla primero para tener un puntaje y un bloqueo que conservar.
  await sonar(page).click();
  await page.keyboard.press('2');
  await page.locator('.floorname', { hasText: 'Beto' }).waitFor();
  await page.getByRole('button', { name: /Incorrecto/ }).click();
  await until(() => sonar(page).isEnabled(), 'Sonar disponible', 1000);
  await sonar(page).click();
  assert.equal(await phaseLabel(page), 'Sonando…');
  const before = await gameState(page);
  assert.equal(before.phase, 'playing');

  await page.reload();
  await page.locator('.stage').waitFor();
  assert.equal(await phaseLabel(page), 'Pulsadores abiertos');
  await page.getByText('Se interrumpió el fragmento: podés repetirlo.').waitFor();
  assert.ok(await sonar(page).isEnabled(), 'Sonar habilitado tras recargar');
  const after = await gameState(page);
  assert.deepEqual(after.players.map((p) => p.score), before.players.map((p) => p.score));
  assert.deepEqual(after.round.lockedPlayerIds, before.round.lockedPlayerIds);
  // Ana todavía puede tocar; Beto sigue bloqueado.
  await sonar(page).click();
  await page.keyboard.press('2');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.floorname').count(), 0, 'Beto sigue bloqueado');
  await page.keyboard.press('1');
  await page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('A02: recargar con alguien con la palabra o con el tema revelado sigue operable', async () => {
  const { ctx, page } = await tableGame();
  await sonar(page).click();
  await page.keyboard.press('1');
  await page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  await page.reload();
  await page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  await page.getByRole('button', { name: /Correcto/ }).click();
  await page.getByText('¡Ana acertó! +1').waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Siguiente tema/ }).click();
  await until(async () => (await phaseLabel(page)) === 'Listo para sonar', 'pasa al tema 2');
  await page.reload();
  assert.ok(await sonar(page).isEnabled());
  assert.equal((await gameState(page)).players[0].score, 1);
  await ctx.close();
});

test('A11: tras recargar en música manual, selector, etiqueta y botones coinciden', async () => {
  const { ctx, page } = await tableGame();
  await page.reload();
  await page.locator('.stage').waitFor();
  await page.getByText('Música manual', { exact: true }).first().waitFor();
  const active = await page.getByTestId('player-active').textContent();
  assert.match(active, /Activo: Música manual/);
  const select = page.locator('.card.soft select');
  await until(async () => (await select.inputValue()) === 'manual', 'el selector muestra música manual');
  assert.equal(await page.getByText('Sin sesión de Spotify').count(), 0, 'sin error de sesión');
  assert.ok(await page.getByRole('button', { name: /Reactivar|Activar/ }).isEnabled());
  assert.ok(await sonar(page).isEnabled());
  await ctx.close();
});
