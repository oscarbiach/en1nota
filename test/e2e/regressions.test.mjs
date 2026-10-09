// Regresiones de la auditoría en navegador real: juez, celulares y TV en
// contextos independientes, música manual (sin Spotify). Requiere el
// servidor en BASE; `npm run test:e2e` lo levanta y lo apaga.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {
  launch, openJudge, openTV, openPlayer, addTablePlayers, addTracks, setSteps, start, gameState, phaseLabel, until, acceptDialogs
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
  // Primero el síntoma de la auditoría: selector y error de sesión.
  const select = page.locator('.card.soft select');
  await until(async () => (await select.inputValue()) === 'manual', 'el selector muestra música manual');
  assert.equal(await page.getByText('Sin sesión de Spotify').count(), 0, 'sin error de sesión');
  const active = await page.getByTestId('player-active').textContent();
  assert.match(active, /Activo: Música manual/);
  assert.ok(await page.getByRole('button', { name: /Reactivar|Activar/ }).isEnabled());
  assert.ok(await sonar(page).isEnabled());
  await ctx.close();
});

// ---------- Bloque 3: resultados coherentes ----------

test('A06: terminar tras acertar el tema 1 de 2 conserva acierto, tema e historial', async () => {
  const { ctx, page, errors } = await tableGame();
  acceptDialogs(page);
  await sonar(page).click();
  await page.keyboard.press('1');
  await page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  await page.getByRole('button', { name: /Correcto/ }).click();
  await page.getByText('¡Ana acertó! +1').waitFor();
  await page.getByRole('button', { name: 'Terminar partida' }).click();
  await page.getByText('Fin de la partida').waitFor();
  // Primero el síntoma de la auditoría: la ronda actual entra al historial.
  assert.equal((await gameState(page)).history.length, 1, 'el tema jugado queda registrado');
  await page.getByText('de 1 temas').waitFor({ timeout: 2000 });
  const ana = page.getByTestId('podium-entry').filter({ hasText: 'Ana' });
  await ana.getByText('1 aciertos').waitFor();
  await page.getByText('de 1 temas').waitFor();
  assert.equal((await gameState(page)).history.length, 1);
  await page.getByRole('button', { name: 'Ver historial' }).click();
  await page.getByText(/^1 temas · Ana 1/).waitFor();
  await page.getByText(/Ana en la pasada 1/).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('A08: con empate, juez, TV e historial anuncian lo mismo', async () => {
  const j = await openJudge(browser);
  acceptDialogs(j.page);
  await addTablePlayers(j.page, ['Beto', 'Ana']);
  await addTracks(j.page, ['Tema Uno', 'Tema Dos']);
  await setSteps(j.page, '0.4');
  const tv = await openTV(browser, j.room);
  await tv.page.getByText('Sumate con tu celu').waitFor();
  await start(j.page);
  for (const key of ['1', '2']) { // Beto acierta el 1, Ana el 2
    await sonar(j.page).click();
    await j.page.keyboard.press(key);
    await j.page.locator('.floorname').waitFor();
    await j.page.getByRole('button', { name: /Correcto/ }).click();
    await j.page.getByRole('button', { name: /Siguiente tema|Terminar partida/ }).first().click();
  }
  await j.page.getByText('Fin de la partida').waitFor();
  const expected = '🤝 Empate: Beto y Ana';
  assert.equal(await j.page.getByTestId('winner-line').textContent(), expected);
  await tv.page.getByTestId('winner-line').getByText(expected).waitFor();
  // Mismo orden y puestos compartidos en ambas pantallas.
  const judgeEntries = await j.page.getByTestId('podium-entry').allTextContents();
  const tvEntries = await tv.page.getByTestId('podium-entry').allTextContents();
  assert.equal(judgeEntries.length, 2);
  assert.deepEqual(tvEntries.map((t) => t.replace(/\d+ aciertos.*$/, '')), judgeEntries.map((t) => t.replace(/\d+ aciertos.*$/, '')));
  await j.page.getByRole('button', { name: 'Ver historial' }).click();
  // El título del ganador también está en la pantalla anterior: esperar al historial.
  await j.page.getByRole('heading', { name: 'Ranking histórico' }).waitFor();
  assert.equal(await j.page.getByTestId('winner-line').textContent(), expected);
  for (const name of ['Beto', 'Ana']) {
    const row = j.page.locator('tbody tr', { hasText: name });
    assert.deepEqual((await row.locator('td.num').allTextContents()), ['1', '1', '1'], `${name}: 1 partida, 1 ganada, 1 punto`);
  }
  assert.deepEqual([...j.errors, ...tv.errors], []);
  await j.ctx.close(); await tv.ctx.close();
});

// ---------- Bloque 4: experiencia de juego ----------

test('A07: en modo mesa no se leen los próximos temas hasta que el juez los pide', async () => {
  const j = await openJudge(browser);
  await addTablePlayers(j.page, ['Ana', 'Beto']);
  await addTracks(j.page, ['Tema Uno', 'Tema Dos', 'Tema Tres']);
  await start(j.page);
  assert.ok(await j.page.getByLabel('Modo mesa').isChecked(), 'modo mesa activo con jugadores de mesa');
  // Primero el síntoma de la auditoría: ningún título futuro en la página.
  const page = await j.page.locator('#root').innerHTML();
  for (const t of ['Tema Dos', 'Tema Tres']) assert.ok(!page.includes(t), `"${t}" no debe estar en la página`);
  const upcoming = j.page.getByTestId('upcoming');
  const hidden = await upcoming.innerHTML();
  for (const t of ['Tema Dos', 'Tema Tres', 'Artista de']) assert.ok(!hidden.includes(t), `"${t}" no debe estar ni en el DOM`);
  assert.equal(await upcoming.getByText('Tema oculto').count(), 2);
  // El juez lo pide manteniendo apretado.
  const btn = upcoming.getByRole('button', { name: 'Mantener para ver' });
  await btn.hover();
  await j.page.mouse.down();
  await upcoming.getByText('Tema Dos', { exact: true }).waitFor();
  await j.page.mouse.up();
  await upcoming.getByText('Tema oculto').first().waitFor();
  // Sin modo mesa (cada uno con su celu) se ven normalmente.
  await j.page.getByLabel('Modo mesa').uncheck();
  await upcoming.getByText('Tema Dos', { exact: true }).waitFor();
  await j.ctx.close();
});

/** Cantidad de pulsaciones que el juez registró en el tema actual. */
const buzzCount = async (page) => (await gameState(page)).round.events.filter((e) => e.kind === 'buzz').length;

test('A09: Enter, Espacio y toque envían exactamente una pulsación cada uno', async () => {
  const j = await openJudge(browser);
  await addTracks(j.page, ['Tema Uno']);
  await j.page.getByText('4 · Reglas').click();
  await j.page.getByLabel('El que falla queda bloqueado en ese tema').uncheck();
  const ana = await openPlayer(browser, j.room, 'Ana');
  await ana.page.getByText('Esperando que arranque la partida').waitFor();
  await start(j.page);
  await sonar(j.page).click();
  const btn = ana.page.locator('.bigbtn');
  await ana.page.getByText('¡TOCÁ!').waitFor();

  const cases = [
    ['Enter', () => btn.press('Enter')],
    ['Espacio', () => btn.press(' ')],
    ['toque', () => btn.tap()]
  ];
  for (let i = 0; i < cases.length; i++) {
    const [label, act] = cases[i];
    await ana.page.getByText('¡TOCÁ!').waitFor();
    await act();
    await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor({ timeout: 2000 }).catch(() => {
      throw new Error(`${label}: la pulsación no llegó al juez`);
    });
    await j.page.waitForTimeout(500); // margen para detectar un duplicado
    assert.equal(await buzzCount(j.page), i + 1, `${label}: exactamente una pulsación`);
    await j.page.getByRole('button', { name: /Incorrecto/ }).click(); // sin bloqueo: puede volver a tocar
  }
  assert.deepEqual([...j.errors, ...ana.errors], []);
  await j.ctx.close(); await ana.ctx.close();
});

test('A09: los pads del juez responden al teclado sin disparar otros atajos', async () => {
  const { ctx, page } = await tableGame();
  await sonar(page).click();
  await page.waitForTimeout(200);
  const pad = page.locator('.pad', { hasText: 'Beto' });
  await pad.focus();
  await page.keyboard.press(' ');
  await page.locator('.floorname', { hasText: 'Beto' }).waitFor();
  await page.waitForTimeout(400);
  assert.equal(await buzzCount(page), 1);
  assert.equal((await gameState(page)).phase, 'buzzed', 'Espacio sobre el pad no hace sonar el tema');
  await ctx.close();
});

test('A10: "Empezar de cero" reincorpora a los celulares conectados', async () => {
  const j = await openJudge(browser);
  acceptDialogs(j.page);
  await addTablePlayers(j.page, ['Mesa']);
  await addTracks(j.page, ['Tema Uno']);
  const beto = await openPlayer(browser, j.room, 'Beto');
  await beto.page.getByText('Esperando que arranque la partida').waitFor();
  await start(j.page);
  await j.page.getByRole('button', { name: 'Revelar (nadie)' }).click();
  await j.page.getByRole('button', { name: 'Terminar partida' }).first().click();
  await j.page.getByText('Fin de la partida').waitFor();
  await beto.page.getByText('Mirá el resultado en la tele').waitFor();

  await j.page.getByRole('button', { name: 'Empezar de cero' }).click();
  await j.page.getByText(/2 · Jugadores \(1\)/).click();
  await j.page.getByText('📱 celu').waitFor();
  const state = await gameState(j.page);
  assert.deepEqual(state.players.map((p) => p.name), ['Beto'], 'queda el celular, se va el jugador de mesa');
  assert.equal(state.tracks.length, 0, 'lista nueva');
  await beto.page.getByText('Esperando que arranque la partida').waitFor();
  assert.equal(await beto.page.getByText('El juez todavía no te agregó').count(), 0);
  // Y puede jugar la partida nueva sin recargar.
  await addTracks(j.page, ['Tema Nuevo']);
  await start(j.page);
  await sonar(j.page).click();
  await beto.page.getByText('¡TOCÁ!').waitFor();
  await beto.page.locator('.bigbtn').tap();
  await j.page.locator('.floorname', { hasText: 'Beto' }).waitFor();
  assert.deepEqual([...j.errors, ...beto.errors], []);
  await j.ctx.close(); await beto.ctx.close();
});

// ---------- Recorridos transversales: conexiones y nueva partida ----------

/** Socket crudo contra el servidor local de pruebas (nunca producción). */
function rawSocket() {
  const url = (process.env.BASE ?? 'http://127.0.0.1:8791').replace(/^http/, 'ws') + '/ws';
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('A03: un mensaje malformado de un intruso no deja en blanco al juez', async () => {
  const j = await openJudge(browser);
  const evil = await rawSocket();
  evil.send(JSON.stringify({ t: 'join', room: j.room, role: 'player', name: 'X' }));
  await new Promise((r) => setTimeout(r, 300));
  for (const data of [
    { k: 'hello', role: 'player', name: { trim: 1 } },
    { k: 'hello', role: 'player', name: null },
    { k: 'rename', name: ['x'] },
    { k: 'buzz', at: 'ya' },
    null
  ]) evil.send(JSON.stringify({ t: 'msg', data }));
  await new Promise((r) => setTimeout(r, 500));
  // El panel sigue dibujado y operable.
  await j.page.getByRole('heading', { name: 'Panel del juez' }).waitFor();
  assert.ok((await j.page.locator('#root').innerHTML()).length > 1000, 'el juez no quedó en blanco');
  assert.equal(await j.page.getByText('Algo falló').count(), 0);
  await addTracks(j.page, ['Tema Uno']);
  await j.page.getByText(/Lista de la partida \(1\)/).waitFor();
  assert.deepEqual(j.errors, []);
  evil.close();
  await j.ctx.close();
});

test('A04/A12: recargar el celular conserva jugador y puntaje; el juez recargado retoma la sala', async () => {
  const j = await openJudge(browser);
  await addTracks(j.page, ['Tema Uno', 'Tema Dos']);
  const ana = await openPlayer(browser, j.room, 'Ana');
  await ana.page.getByText('Esperando que arranque la partida').waitFor();
  await start(j.page);
  await sonar(j.page).click();
  await ana.page.locator('.bigbtn').tap();
  await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  await j.page.getByRole('button', { name: /Correcto/ }).click();
  const before = await gameState(j.page);
  const anaId = before.players[0].id;

  // Recarga del celular: misma identidad, mismo puntaje.
  await ana.page.reload();
  await ana.page.locator('.top', { hasText: 'Ana' }).getByText('1', { exact: true }).waitFor();
  const after = await gameState(j.page);
  assert.equal(after.players.length, 1, 'no se duplica el jugador');
  assert.equal(after.players[0].id, anaId);
  assert.equal(after.players[0].connected, true);

  // Recarga del juez: misma sala, el celular sigue jugando.
  await j.page.reload();
  await j.page.locator('.stage').waitFor();
  await j.page.getByText(`Sala ${j.room}`).waitFor();
  await j.page.getByRole('button', { name: /Siguiente tema/ }).click();
  await sonar(j.page).click();
  await ana.page.getByText('¡TOCÁ!').waitFor();
  await ana.page.locator('.bigbtn').tap();
  await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  assert.deepEqual([...j.errors, ...ana.errors], []);
  await j.ctx.close(); await ana.ctx.close();
});

test('A05: abrir el juez en otra pestaña desplaza a la anterior sin que ésta siga mandando', async () => {
  const j = await openJudge(browser);
  await addTracks(j.page, ['Tema Uno']);
  const tv = await openTV(browser, j.room);
  await tv.page.getByText('Sumate con tu celu').waitFor();
  // "Duplicar pestaña": la copia hereda sessionStorage, con la clave de la sala.
  const saved = await j.page.evaluate(() => sessionStorage.getItem('en1nota.room'));
  assert.ok(saved, 'el juez guarda sala y clave');
  const second = await j.ctx.newPage();
  await second.addInitScript((v) => sessionStorage.setItem('en1nota.room', v), saved);
  await second.goto(j.page.url());
  await second.getByText(`Sala ${j.room}`).first().waitFor();
  await j.page.getByText('La sala se abrió en otro lado').waitFor();
  // La pestaña nueva manda; la TV sigue en la sala.
  await addTablePlayers(second, ['Nueva']);
  await tv.page.getByText('Nueva').waitFor();
  assert.deepEqual(tv.errors, []);
  await j.ctx.close(); await tv.ctx.close();
});

test('Nueva partida con los mismos jugadores: puntajes en cero, mismos celulares', async () => {
  const j = await openJudge(browser);
  await addTracks(j.page, ['Tema Uno']);
  const ana = await openPlayer(browser, j.room, 'Ana');
  await ana.page.getByText('Esperando que arranque la partida').waitFor();
  await start(j.page);
  await sonar(j.page).click();
  await ana.page.locator('.bigbtn').tap();
  await j.page.getByRole('button', { name: /Correcto/ }).click();
  await j.page.getByRole('button', { name: 'Terminar partida' }).first().click();
  await j.page.getByText('Fin de la partida').waitFor();
  await j.page.getByRole('button', { name: 'Nueva partida con los mismos' }).click();
  await start(j.page);
  const g = await gameState(j.page);
  assert.deepEqual(g.players.map((p) => [p.name, p.score]), [['Ana', 0]]);
  await sonar(j.page).click();
  await ana.page.getByText('¡TOCÁ!').waitFor();
  await ana.page.locator('.bigbtn').tap();
  await j.page.locator('.floorname', { hasText: 'Ana' }).waitFor();
  await j.ctx.close(); await ana.ctx.close();
});
