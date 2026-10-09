// Regresión A03 del lado cliente: validación de lo que llega por la red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHostMsg, parsePeerMsg } from '../src/net/validate.ts';
import * as E from '../src/game/engine.ts';

test('A03: parsePeerMsg rechaza formas inválidas', () => {
  const bad: unknown[] = [
    null, undefined, 'hola', 42, [], {},
    { k: 'hello', role: 'player', name: { trim: 1 } },
    { k: 'hello', role: 'player' },
    { k: 'hello', role: 'admin', name: 'x' },
    { k: 'rename', name: null },
    { k: 'buzz' },
    { k: 'buzz', at: 'ya' },
    { k: 'buzz', at: Infinity },
    { k: 'state', state: {} }
  ];
  for (const b of bad) assert.equal(parsePeerMsg(b), null, JSON.stringify(b));
});

test('parsePeerMsg acepta y sanea mensajes válidos', () => {
  assert.deepEqual(parsePeerMsg({ k: 'hello', role: 'player', name: '  Ana  ', x: 1 }), { k: 'hello', role: 'player', name: 'Ana' });
  assert.deepEqual(parsePeerMsg({ k: 'buzz', at: 5 }), { k: 'buzz', at: 5, localAt: 5 });
  assert.equal(parsePeerMsg({ k: 'rename', name: 'x'.repeat(100) })?.name.length, 24);
});

test('A03: parseHostMsg acepta el estado real del motor y rechaza estados rotos', () => {
  let g = E.addPlayer(E.newGame(), 'Ana', 'aaaaaaaa');
  g = E.startGame({ ...g, tracks: [{ id: 't', uri: 'u', name: 'T', artists: 'A', album: 'B', durationMs: 1, startMs: 0 }] });
  const ok = { k: 'state', state: E.toPublic(g), serverNow: 1 };
  assert.ok(parseHostMsg(ok));
  const finished = { k: 'state', state: E.toPublic(E.finishGame(g)), serverNow: 1 };
  assert.ok(parseHostMsg(finished), 'el estado final con ranking también es válido');

  const broken = [
    { k: 'state', state: { ...ok.state, phase: 'hackeado' }, serverNow: 1 },
    { k: 'state', state: { ...ok.state, players: [{ id: 1 }] }, serverNow: 1 },
    { k: 'state', state: { ...ok.state, players: 'x' }, serverNow: 1 },
    { k: 'state', state: ok.state },
    { k: 'welcome', playerId: 'a', name: { a: 1 }, color: '#fff' },
    { k: 'sfx', name: 'explosion' },
    { k: 'rejected' },
    { k: 'otra' },
    null
  ];
  for (const b of broken) assert.equal(parseHostMsg(b), null, JSON.stringify(b).slice(0, 80));
});

test('A03: el motor tolera nombres que no son texto', () => {
  const g = E.addPlayer(E.newGame(), { trim: 1 } as unknown as string);
  assert.equal(g.players[0].name, 'Jugador 1');
  const r = E.renamePlayer(g, g.players[0].id, null as unknown as string);
  assert.equal(r.players[0].name, 'Jugador 1');
});
