// Capturas de revisión local. Ejecutar con un servidor levantado y BASE configurado.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BASE, launch, openJudge, addTablePlayers, addTracks, start } from './helpers.mjs';
const out = resolve(process.env.PREVIEW_OUT ?? 'test/e2e/out/design');
mkdirSync(out, { recursive: true });
const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.screenshot({ path: resolve(out, 'inicio-escritorio.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'inicio-celular.png'), fullPage: true });
  const j = await openJudge(browser);
  await j.page.emulateMedia({ reducedMotion: 'reduce' });
  await j.page.getByRole('button', { name: /1 contra 1 Dos jugadores/ }).click();
  await addTablePlayers(j.page, ['Oscar', 'Flor']);
  await addTracks(j.page, ['Música Ligera', 'De Música Ligera']);
  await start(j.page);
  await j.page.screenshot({ path: resolve(out, 'duelo-listo.png'), fullPage: true });
  await j.page.getByRole('button', { name: /^▶ Sonar/ }).click();
  await j.page.keyboard.press('1');
  await j.page.locator('.floorname').waitFor();
  await j.page.keyboard.press('2');
  await j.page.getByLabel('Orden de turnos').getByText('Flor').waitFor();
  await j.page.screenshot({ path: resolve(out, 'duelo-cola.png'), fullPage: true });
  await j.page.setViewportSize({ width: 390, height: 844 });
  await j.page.screenshot({ path: resolve(out, 'duelo-celular.png'), fullPage: true });
  await j.ctx.close();
  const s = await openJudge(browser);
  await s.page.getByRole('button', { name: /Solitario Tu oído/ }).click();
  await addTablePlayers(s.page, ['Oscar']); await addTracks(s.page, ['Música Ligera']); await start(s.page);
  await s.page.getByRole('button', { name: /^▶ Sonar/ }).click();
  await s.page.getByLabel('¿Cómo se llama la canción?').fill('Musica…');
  await s.page.screenshot({ path: resolve(out, 'solitario.png'), fullPage: true });
  await s.ctx.close(); await context.close();
  console.log(`Capturas: ${out}`);
} finally { await browser.close(); }
