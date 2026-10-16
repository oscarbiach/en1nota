import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openJudge, openPlayer, openTV, addTablePlayers, addTracks, start, gameState, until, BASE } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
const play = (p) => p.getByRole('button', { name: /^▶ Sonar/ }).click();

test('cola real: dos celulares, mesa y TV; error promueve sin tocar otra vez', async () => {
  const j = await openJudge(browser);
  await addTablePlayers(j.page, ['Mesa']);
  const a = await openPlayer(browser, j.room, 'Ana');
  const b = await openPlayer(browser, j.room, 'Beto');
  const tv = await openTV(browser, j.room);
  try {
    await b.page.getByText('Esperando que arranque la partida').waitFor();
    await addTracks(j.page, ['Secreto Uno', 'Secreto Dos']);
    await start(j.page); await play(j.page);
    await a.page.getByText('¡TOCÁ!').waitFor();
    await a.page.locator('.bigbtn').tap();
    await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
    assert.ok(await b.page.locator('.bigbtn').isEnabled(), 'otro jugador puede sumarse mientras Ana habla');
    await b.page.locator('.bigbtn').tap();
    await b.page.getByText('En espera · 1', { exact: true }).waitFor();
    assert.ok(await b.page.locator('.bigbtn').isDisabled());
    await j.page.keyboard.press('1');
    await until(async () => (await gameState(j.page)).round.queue.length === 2, 'dos turnos en cola');
    await j.page.reload();
    await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
    await j.page.getByRole('button', { name: /Incorrecto/ }).click();
    await b.page.getByText('¡Tuya!').waitFor();
    await tv.page.locator('.huge', { hasText: 'Beto' }).waitFor();
    await a.page.getByText('Bloqueado', { exact: true }).waitFor();
    await j.page.getByRole('button', { name: /En blanco/ }).click();
    await j.page.locator('.floorname', { hasText: 'Mesa' }).waitFor();
    await j.page.getByRole('button', { name: /Correcto/ }).click();
    const g = await gameState(j.page);
    assert.deepEqual(g.players.map((p) => [p.name, p.score]), [['Mesa', 1], ['Ana', -1], ['Beto', -1]]);
    assert.deepEqual(g.round.queue, []);
    assert.deepEqual([...j.errors, ...a.errors, ...b.errors, ...tv.errors], []);
  } finally { await Promise.all([j.ctx.close(), a.ctx.close(), b.ctx.close(), tv.ctx.close()]); }
});

test('solitario escrito: título oculto, acierto automático, fallo y resultado final', async () => {
  const j = await openJudge(browser);
  try {
    await j.page.getByRole('button', { name: /Solitario Tu oído/ }).click();
    await addTablePlayers(j.page, ['Oscar']);
    await addTracks(j.page, ['Música Ligera', 'Otro Tema']);
    await start(j.page);
    assert.equal(await j.page.getByText('Música Ligera', { exact: true }).count(), 0);
    assert.equal(await j.page.getByText('Otro Tema', { exact: true }).count(), 0);
    assert.ok(await j.page.getByLabel('¿Cómo se llama la canción?').isDisabled());
    await play(j.page);
    await j.page.getByLabel('¿Cómo se llama la canción?').fill('MUSICA LIGERA!');
    await j.page.getByRole('button', { name: 'Responder', exact: true }).click();
    await j.page.getByText('¡Oscar acertó! +1').waitFor();
    await j.page.getByRole('button', { name: /Siguiente tema/ }).click();
    await play(j.page);
    await j.page.getByLabel('¿Cómo se llama la canción?').fill('No es esta');
    await j.page.getByRole('button', { name: 'Responder', exact: true }).click();
    await j.page.getByText('Otro Tema', { exact: true }).waitFor();
    await j.page.locator('.stage').getByRole('button', { name: 'Terminar partida', exact: true }).click();
    assert.equal((await gameState(j.page)).players[0].score, 0);
    assert.deepEqual(j.errors, []);
  } finally { await j.ctx.close(); }
});

test('solitario: recargar con tiempo agotado registra un único fallo', async () => {
  const j = await openJudge(browser);
  try {
    await j.page.getByRole('button', { name: /Solitario Tu oído/ }).click();
    await addTablePlayers(j.page, ['Oscar']); await addTracks(j.page, ['Tema Secreto']);
    await start(j.page); await play(j.page);
    // Simula volver a una pestaña cuyo plazo ya venció, sin esperar 30 s reales.
    await j.page.evaluate(() => {
      const g = JSON.parse(localStorage.getItem('en1nota.game'));
      g.round.answerDeadline = Date.now() - 1000;
      localStorage.setItem('en1nota.game', JSON.stringify(g));
    });
    await j.page.reload();
    await j.page.getByText('Tema Secreto', { exact: true }).waitFor();
    await j.page.reload();
    await j.page.locator('.stage').waitFor();
    const g = await gameState(j.page);
    assert.equal(g.players[0].score, -1);
    assert.equal(g.round.events.filter((e) => e.kind === 'timeout').length, 1);
    assert.deepEqual(j.errors, []);
  } finally { await j.ctx.close(); }
});

test('duelo sin juez: ambos responden, se comprueba y el segundo gana al fallar el primero', async () => {
  const j = await openJudge(browser);
  try {
    await j.page.getByRole('button', { name: /1 contra 1 Dos jugadores/ }).click();
    await addTablePlayers(j.page, ['Ana', 'Beto']); await addTracks(j.page, ['Título Oculto']);
    await start(j.page); await play(j.page);
    await j.page.keyboard.press('1');
    await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
    await j.page.keyboard.press('2');
    await j.page.getByLabel('Orden de turnos').getByText('Beto').waitFor();
    assert.equal(await j.page.getByText('Título Oculto', { exact: true }).count(), 0);
    await j.page.getByRole('button', { name: 'Comprobar respuesta' }).click();
    await j.page.getByText('Título Oculto', { exact: true }).waitFor();
    await j.page.getByRole('button', { name: /Incorrecto/ }).click();
    await j.page.locator('.floorname', { hasText: 'Beto' }).waitFor();
    await j.page.getByRole('button', { name: /Correcto/ }).click();
    await j.page.locator('.stage').getByRole('button', { name: 'Terminar partida', exact: true }).click();
    await j.page.getByTestId('winner-line').getByText('🏆 Ganó Beto').waitFor();
    assert.deepEqual(j.errors, []);
  } finally { await j.ctx.close(); }
});

test('solitario con autoevaluación permite cantar y marcar sin reloj', async () => {
  const j = await openJudge(browser);
  try {
    await j.page.getByRole('button', { name: /Solitario Tu oído/ }).click();
    await j.page.getByLabel('Cómo querés responder').selectOption('self');
    await addTablePlayers(j.page, ['Oscar']); await addTracks(j.page, ['Canción']);
    await start(j.page); await play(j.page); await j.page.keyboard.press('1');
    await j.page.getByRole('button', { name: 'Comprobar respuesta' }).click();
    await j.page.getByRole('button', { name: /Correcto/ }).click();
    assert.equal((await gameState(j.page)).players[0].score, 1);
    assert.equal(await j.page.getByRole('timer').count(), 0);
    assert.deepEqual(j.errors, []);
  } finally { await j.ctx.close(); }
});

test('inicio y configuración móviles sin desborde, incluso con movimiento reducido', async () => {
  const c = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
  const p = await c.newPage();
  try {
    await p.goto(BASE);
    assert.equal(await p.locator('.home-modes .mode-card').count(), 3);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.getByRole('button', { name: /01.*Solitario/ }).click();
    await p.getByRole('heading', { name: 'Armá tu partida' }).waitFor();
    assert.ok(await p.getByRole('button', { name: /Solitario Tu oído/ }).getAttribute('aria-pressed') === 'true');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await c.close(); }
});
