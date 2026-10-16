// Regresiones B04 y B06 (segunda auditoría): guardado que falla se informa;
// datos guardados inválidos no bloquean la app ni se pierden. Storage simulado.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemStorage {
  map = new Map<string, string>();
  failOn: ((key: string) => boolean) | null = null;
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.failOn?.(k)) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; }
    this.map.set(k, String(v));
  }
  removeItem(k: string) { this.map.delete(k); }
}
const ls = new MemStorage();
(globalThis as unknown as Record<string, unknown>).localStorage = ls;

const S = await import('../src/storage/store.ts');
const E = await import('../src/game/engine.ts');
type Issue = Parameters<Parameters<typeof S.onStorageIssue>[0]>[0];

let issues: Issue[] = [];
S.onStorageIssue((i) => issues.push(i));
beforeEach(() => { ls.map.clear(); ls.failOn = null; issues = []; });

const track = { id: 't1', uri: 'manual:t1', name: 'Tema', artists: 'A', album: '', durationMs: 1000, startMs: 0 };
const playlist = { id: 'p1', name: 'Lista', tracks: [track], updatedAt: 1 };
const quarantined = () => [...ls.map.keys()].filter((k) => k.startsWith('en1nota.quarantine.'));

function realGame() {
  let g = E.addPlayer(E.newGame(), 'Ana', 'abcdef123456', true);
  g = E.startGame({ ...g, tracks: [track] });
  return E.judgeCorrect(E.resolveBuzzes(E.receiveBuzz(E.markPlaying(g, 0), { playerId: 'abcdef123456', at: 5 })));
}

// ---------- B04 ----------

test('B04: con el almacenamiento lleno, guardar una lista devuelve false y avisa', () => {
  ls.failOn = () => true;
  assert.equal(S.savePlaylist(playlist), false);
  assert.deepEqual(issues, [{ kind: 'write-failed', what: 'las listas', quota: true }]);
  ls.failOn = null;
  assert.equal(S.loadPlaylists().length, 0, 'no dice que guardó lo que no guardó');
});

test('B04: la partida que no se pudo guardar también se informa', () => {
  ls.failOn = (k) => k === 'en1nota.game';
  assert.equal(S.saveGame(realGame()), false);
  assert.equal(issues[0].kind, 'write-failed');
  assert.equal(issues[0].kind === 'write-failed' && issues[0].what, 'la partida');
});

test('B04: guardar normal devuelve true y no avisa', () => {
  assert.equal(S.savePlaylist(playlist), true);
  assert.equal(S.saveGame(realGame()), true);
  assert.deepEqual(issues, []);
});

test('B04: el respaldo incluye datos y memoria, nunca credenciales de Spotify', () => {
  S.savePlaylist(playlist);
  ls.setItem('en1nota.spotify.token', JSON.stringify({ accessToken: 'SECRETO' }));
  const g = realGame();
  const out = S.exportBackup({ game: g });
  assert.ok(!out.includes('SECRETO'));
  const j = JSON.parse(out);
  assert.equal(j.storage['en1nota.playlists'][0].name, 'Lista');
  assert.equal(j.memory.game.players[0].score, 1);
});

test('B04: liberar espacio borra sólo diagnósticos (e historial si se pide)', () => {
  S.savePlaylist(playlist);
  S.pushHistory(E.finishGame(realGame()));
  ls.setItem('en1nota.quarantine.game.1', '{}');
  assert.equal(S.freeSpace(), 1);
  assert.equal(S.loadPlaylists().length, 1);
  assert.equal(S.loadHistory().length, 1);
  assert.equal(S.freeSpace({ history: true }), 1);
  assert.equal(S.loadHistory().length, 0);
  assert.equal(S.loadPlaylists().length, 1, 'las listas nunca se borran');
});

// ---------- B06 ----------

test('B06: una partida "{}" no bloquea: se aparta, se avisa y listas e historial siguen', () => {
  S.savePlaylist(playlist);
  S.pushHistory(E.finishGame(realGame()));
  ls.setItem('en1nota.game', '{}');
  assert.equal(S.loadGame(), null);
  assert.equal(ls.getItem('en1nota.game'), null, 'no queda para fallar de nuevo al recargar');
  assert.equal(quarantined().length, 1);
  assert.equal(ls.getItem(quarantined()[0]), '{}', 'la copia de diagnóstico es el dato original');
  assert.equal(issues[0].kind, 'recovered');
  assert.equal(S.loadPlaylists().length, 1);
  assert.equal(S.loadHistory().length, 1);
  assert.equal(S.loadGame(), null, 'la segunda lectura ya no encuentra nada roto');
  assert.equal(issues.length, 1);
});

test('B06: JSON roto y versiones futuras tampoco bloquean', () => {
  ls.setItem('en1nota.game', '{"players": [');
  assert.equal(S.loadGame(), null);
  ls.setItem('en1nota.game', JSON.stringify({ ...realGame(), v: 99 }));
  assert.equal(S.loadGame(), null, 'no adivina formatos de una versión futura');
  assert.equal(quarantined().length, 2);
});

test('B06: una partida de la versión anterior (sin v, sin campos nuevos) se migra', () => {
  const g = realGame() as unknown as Record<string, unknown>;
  const old = JSON.parse(JSON.stringify(g));
  delete old.round.pending;
  delete old.settings.lockOnFail;
  delete old.settings.shuffleOnStart;
  old.players[0].remote = undefined;
  ls.setItem('en1nota.game', JSON.stringify(old));
  const loaded = S.loadGame()!;
  assert.ok(loaded);
  assert.equal(loaded.players[0].score, 1);
  assert.deepEqual(loaded.round.pending, []);
  assert.equal(loaded.settings.lockOnFail, true);
  assert.equal(loaded.settings.shuffleOnStart, true, 'las partidas guardadas antes de la opción también mezclan');
  assert.deepEqual(issues, []);
});

test('B06: ida y vuelta de una partida real conserva todo', () => {
  const g = E.finishGame(realGame());
  S.saveGame(g);
  // Por JSON, como el almacenamiento: `campo: undefined` y campo ausente son lo mismo.
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(S.loadGame()), plain(g));
});

test('B06: una lista dañada se aparta sin perder las demás', () => {
  ls.setItem('en1nota.playlists', JSON.stringify([playlist, { id: 7 }, { ...playlist, id: 'p2', tracks: [{ nombre: 'x' }] }]));
  const lists = S.loadPlaylists();
  assert.deepEqual(lists.map((p) => p.id), ['p1']);
  assert.equal(quarantined().length, 1);
  assert.equal(JSON.parse(ls.getItem(quarantined()[0])!).length, 2);
  assert.equal(issues[0].kind, 'recovered');
  assert.equal(S.loadPlaylists().length, 1, 'quedó limpia');
});

test('B06: preferencias con tipos inválidos vuelven a su valor por defecto', () => {
  ls.setItem('en1nota.playerMode', JSON.stringify({ x: 1 }));
  ls.setItem('en1nota.playerName', JSON.stringify(42));
  ls.setItem('en1nota.settings', JSON.stringify([1, 2]));
  assert.equal(S.loadPlayerMode(), null);
  assert.equal(S.loadPlayerName(), '');
  assert.deepEqual(S.loadSettings(), {});
});
