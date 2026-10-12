// Regresión B09 en navegador: se reinicia el servidor local en plena partida.
// Levanta y apaga su propio servidor (puerto 8793); nunca toca producción.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = process.env.E2E_RESTART_PORT ?? '8793';
process.env.BASE = `http://127.0.0.1:${PORT}`;
const { launch, openJudge, openPlayer, addTracks, setSteps, start, gameState, until } = await import('./helpers.mjs');

let browser;
let server;
before(async () => { browser = await launch(); });
after(async () => { await stop(); await browser?.close(); });

async function boot(secret) {
  server = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT, ROOM_SECRET: secret ?? '' },
    stdio: ['ignore', 'pipe', 'ignore']
  });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (d.toString().includes('escuchando')) resolve(); });
    server.once('exit', (c) => reject(new Error(`el servidor terminó (código ${c})`)));
  });
}
async function stop() {
  if (!server) return;
  const s = server;
  server = undefined;
  await new Promise((r) => { s.once('exit', r); s.kill(); });
}

const sonar = (page) => page.getByRole('button', { name: /^▶ Sonar/ });

/** Partida con Ana en su celular, que acierta el primer tema (1 punto). */
async function gameWithAna() {
  const j = await openJudge(browser);
  await addTracks(j.page, ['Tema Uno', 'Tema Dos', 'Tema Tres']);
  await setSteps(j.page, '0.4');
  const ana = await openPlayer(browser, j.room, 'Ana');
  await ana.page.getByText('Esperando que arranque la partida').waitFor();
  await start(j.page);
  await sonar(j.page).click();
  await ana.page.getByText('¡TOCÁ!').waitFor();
  await ana.page.locator('.bigbtn').tap();
  await j.page.getByRole('button', { name: /Correcto/ }).click();
  await j.page.getByRole('button', { name: /Siguiente tema/ }).click();
  const before = await gameState(j.page);
  assert.equal(before.players[0].score, 1);
  return { j, ana, anaId: before.players[0].id };
}

/** Ana vuelve a tocar y el juez la ve con la palabra. */
async function anaCanStillPlay(j, ana) {
  await until(() => sonar(j.page).isEnabled(), 'Sonar disponible', 5000);
  await sonar(j.page).click();
  await ana.page.getByText('¡TOCÁ!').waitFor({ timeout: 10000 });
  await ana.page.locator('.bigbtn').tap();
  await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
}

test('B09: con ROOM_SECRET, tras reiniciar el servidor todo sigue en la misma sala', async () => {
  await boot('secreto-estable-de-prueba');
  const { j, ana, anaId } = await gameWithAna();
  await stop();
  await boot('secreto-estable-de-prueba');

  // Los dos reconectan solos: mismo código, mismo jugador, mismo puntaje.
  await j.page.locator('.pill.on', { hasText: `Sala ${j.room}` }).waitFor({ timeout: 15000 });
  await ana.page.locator('.pill.on', { hasText: j.room }).waitFor({ timeout: 15000 });
  await until(async () => (await gameState(j.page)).players[0].connected, 'Ana figura conectada', 10000);
  const g = await gameState(j.page);
  assert.equal(g.players.length, 1);
  assert.equal(g.players[0].id, anaId);
  assert.equal(g.players[0].score, 1);
  assert.equal(await j.page.getByTestId('room-changed').count(), 0, 'no hace falta código nuevo');
  await anaCanStillPlay(j, ana);
  assert.deepEqual([...j.errors, ...ana.errors], []);
  await j.ctx.close(); await ana.ctx.close();
  await stop();
});

test('B09: sin ROOM_SECRET, el juez confirma quién es y conserva el puntaje; un intruso no entra', async () => {
  await boot();
  const { j, ana } = await gameWithAna();
  await stop();
  await boot();

  // El juez obtiene sala nueva y lo dice claramente.
  const notice = j.page.getByTestId('room-changed');
  await notice.waitFor({ timeout: 15000 });
  const newRoom = (await notice.locator('.code').textContent()).trim();
  assert.match(newRoom, /^[A-Z]{4}$/);
  assert.notEqual(newRoom, j.room);
  // Ana pierde la sala vieja y entra con el código nuevo desde el mismo pulsador.
  await ana.page.getByText('Esa sala no existe').waitFor({ timeout: 15000 });
  await ana.page.getByLabel('Código nuevo de la sala').fill(newRoom);
  await ana.page.getByRole('button', { name: 'Entrar' }).click();
  await ana.page.getByText('Esperando al juez').waitFor();
  // El juez confirma que es Ana: retoma su puesto con su punto.
  const req = j.page.getByTestId('join-request').filter({ hasText: 'Ana' });
  await req.getByRole('button', { name: /^Es Ana \(1\)/ }).click();
  await ana.page.locator('.top', { hasText: 'Ana' }).getByText('1', { exact: true }).waitFor();
  const g = await gameState(j.page);
  assert.equal(g.players.length, 1, 'no se duplica');
  assert.equal(g.players[0].score, 1);
  assert.equal(g.history[0].solvedBy, g.players[0].id, 'el historial sigue a la nueva conexión');
  await anaCanStillPlay(j, ana);

  // Alguien más entra con el código: no recibe ningún puesto sin el juez.
  const intruso = await (await import('./helpers.mjs')).openPlayer(browser, newRoom, 'Ana');
  await intruso.page.getByText('Esperando al juez').waitFor();
  assert.equal((await gameState(j.page)).players.length, 1);
  await j.page.getByTestId('join-request').getByRole('button', { name: 'Rechazar' }).click();
  await intruso.page.getByText('El juez no te sumó a esta partida.').waitFor();
  assert.deepEqual([...j.errors, ...ana.errors, ...intruso.errors], []);
  await j.ctx.close(); await ana.ctx.close(); await intruso.ctx.close();
  await stop();
});
