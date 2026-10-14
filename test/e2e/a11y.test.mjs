// Regresión B07 (segunda auditoría) y revisión automática de accesibilidad:
// axe-core con reglas WCAG 2.1 A/AA en todas las pantallas. Una revisión
// automática no certifica conformidad: contraste y uso real con lector de
// pantalla siguen requiriendo revisión manual.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  BASE, launch, openJudge, openPlayer, openTV, addTablePlayers, addTracks, start, acceptDialogs
} from './helpers.mjs';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

async function scan(page, label) {
  // El contraste se mide con la pantalla quieta, no a mitad de un fundido.
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* infinita */ } }));
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5) }));
  });
  assert.deepEqual(r, [], `${label}: ${JSON.stringify(r, null, 1)}`);
}

test('B07: el viewport no bloquea el zoom', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  assert.ok(!/user-scalable\s*=\s*(no|0)/i.test(content), content);
  const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(content);
  assert.ok(!max || Number(max[1]) >= 5, content);
  await ctx.close();
});

test('B07: nuevos modos solitario y duelo sin violaciones WCAG automáticas', async () => {
  for (const mode of ['solo', 'duel']) {
    const j = await openJudge(browser);
    try {
      await j.page.getByRole('button', { name: mode === 'solo' ? /Solitario Tu oído/ : /1 contra 1 Dos jugadores/ }).click();
      await scan(j.page, `${mode}: preparación`);
      await addTablePlayers(j.page, mode === 'solo' ? ['Ana'] : ['Ana', 'Beto']);
      await addTracks(j.page, ['Tema Secreto']); await start(j.page);
      await j.page.getByRole('button', { name: /^▶ Sonar/ }).click();
      if (mode === 'duel') {
        await j.page.keyboard.press('1'); await j.page.locator('.floorname').waitFor(); await j.page.keyboard.press('2');
      }
      await scan(j.page, `${mode}: jugando`);
    } finally { await j.ctx.close(); }
  }
});

test('B07: inicio e historial sin violaciones WCAG automáticas', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Entrá a la ronda.' }).waitFor();
  await scan(page, 'Inicio');
  await page.goto(`${BASE}/#/historial`);
  await page.getByRole('heading', { name: 'Historial' }).waitFor();
  await scan(page, 'Historial vacío');
  await ctx.close();
});

test('B07: panel del juez (lobby y juego) sin violaciones WCAG automáticas', async () => {
  const j = await openJudge(browser);
  acceptDialogs(j.page);
  for (const tab of ['1 · Spotify', /2 · Jugadores/, /3 · Canciones/, '4 · Reglas']) {
    await j.page.getByText(tab).click();
    await scan(j.page, `Juez: ${tab}`);
  }
  await addTablePlayers(j.page, ['Ana', 'Beto']);
  await addTracks(j.page, ['Tema Uno', 'Tema Dos']);
  await scan(j.page, 'Juez: lista cargada');
  await start(j.page);
  await scan(j.page, 'Juez: en juego');
  await j.page.getByRole('button', { name: /^▶ Sonar/ }).click();
  await j.page.keyboard.press('1');
  await j.page.locator('.floorname').waitFor();
  await scan(j.page, 'Juez: alguien tiene la palabra');
  await j.page.getByRole('button', { name: /Correcto/ }).click();
  await j.page.getByText('Ajustes rápidos', { exact: true }).click();
  await j.page.getByRole('button', { name: 'Terminar partida' }).first().click();
  await j.page.getByText('Fin de la partida').waitFor();
  await scan(j.page, 'Juez: fin');
  await j.page.getByRole('button', { name: 'Ver historial' }).click();
  await j.page.getByRole('heading', { name: 'Ranking histórico' }).waitFor();
  await scan(j.page, 'Historial con partidas');
  await j.ctx.close();
});

test('B07: celular y TV sin violaciones WCAG automáticas', async () => {
  const j = await openJudge(browser);
  await addTracks(j.page, ['Tema Uno']);
  const ana = await openPlayer(browser, j.room, 'Ana');
  await ana.page.getByText('Esperando que arranque la partida').waitFor();
  await scan(ana.page, 'Celular: lobby');
  const tv = await openTV(browser, j.room);
  await tv.page.getByText('Sumate con tu celu').waitFor();
  await scan(tv.page, 'TV: lobby');
  await start(j.page);
  await j.page.getByRole('button', { name: /^▶ Sonar/ }).click();
  await ana.page.getByText('¡TOCÁ!').waitFor();
  await scan(ana.page, 'Celular: pulsadores abiertos');
  await ana.page.locator('.bigbtn').tap();
  await tv.page.getByText('tiene la palabra').waitFor();
  await scan(tv.page, 'TV: alguien tiene la palabra');
  await j.ctx.close(); await ana.ctx.close(); await tv.ctx.close();
});

test('B07: a 320 px de ancho (≈ 400 % de zoom) no hay desplazamiento horizontal y el pulsador sirve', async () => {
  const j = await openJudge(browser);
  await addTracks(j.page, ['Tema Uno']);
  const ctx = await browser.newContext({ viewport: { width: 320, height: 560 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Entrá a la ronda.' }).waitFor();
  assert.ok(await overflow() <= 0, 'inicio');
  await page.getByLabel('Tu nombre').fill('Ana');
  await page.getByPlaceholder('ABCD').first().fill(j.room);
  await page.getByRole('button', { name: 'Entrar con mi celu' }).click();
  await page.getByText('Esperando que arranque la partida').waitFor();
  assert.ok(await overflow() <= 0, 'pulsador');
  await start(j.page);
  await j.page.getByRole('button', { name: /^▶ Sonar/ }).click();
  await page.getByText('¡TOCÁ!').waitFor();
  const box = await page.locator('.bigbtn').boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 320 && box.height >= 200, JSON.stringify(box));
  await page.locator('.bigbtn').tap();
  await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  // El panel del juez también se puede usar angosto.
  await j.page.setViewportSize({ width: 320, height: 700 });
  assert.ok(await j.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'panel del juez');
  await ctx.close(); await j.ctx.close();
});
