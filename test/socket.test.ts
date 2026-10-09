// Regresión A12: la clase Socket real con WebSocket y reloj simulados.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class FakeWS {
  static OPEN = 1;
  static all: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; FakeWS.all.push(this); }
  send(s: string) { this.sent.push(s); }
  close() { this.serverClose(1000); }
  // ayudas para la prueba
  serverOpen() { this.readyState = 1; this.onopen?.(); }
  serverClose(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
  serverSend(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

const g = globalThis as unknown as Record<string, unknown>;
g.WebSocket = FakeWS;
g.window = globalThis;
g.location = { protocol: 'http:', host: 'test.local' };

const { Socket } = await import('../src/net/socket.ts');

beforeEach(() => {
  FakeWS.all = [];
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

test('A12: cerrar con un reintento pendiente no abre otro socket', () => {
  const s = new Socket();
  let online = 0;
  s.onOnline = (o) => { if (o) online++; };
  s.connect();
  assert.equal(FakeWS.all.length, 1);
  FakeWS.all[0].serverOpen();
  FakeWS.all[0].serverClose(1006); // se cae la red: agenda reintento
  s.close(); // el usuario sale antes del reintento
  mock.timers.tick(60_000);
  assert.equal(FakeWS.all.length, 1, 'no debe construir sockets nuevos tras close()');
  assert.equal(online, 1);
});

test('A12: un socket viejo no dispara callbacks después de cerrar', () => {
  const s = new Socket();
  const got: string[] = [];
  s.on((m) => got.push(m.t));
  let opens = 0;
  s.onOpen(() => opens++);
  s.connect();
  const first = FakeWS.all[0];
  first.serverOpen();
  s.close();
  first.serverSend({ t: 'host_gone' });
  first.onopen?.();
  assert.deepEqual(got, [], 'no debe entregar mensajes a vistas desmontadas');
  assert.equal(opens, 1);
});

test('reconecta tras una caída de red mientras no se cierre', () => {
  const s = new Socket();
  s.connect();
  FakeWS.all[0].serverOpen();
  FakeWS.all[0].serverClose(1006);
  mock.timers.tick(600);
  assert.equal(FakeWS.all.length, 2);
  // Eventos tardíos del socket anterior no afectan al nuevo.
  const got: string[] = [];
  s.on((m) => got.push(m.t));
  FakeWS.all[0].serverSend({ t: 'kicked' });
  FakeWS.all[1].serverOpen();
  FakeWS.all[1].serverSend({ t: 'host_back' });
  assert.deepEqual(got, ['host_back']);
  s.close();
});

test('A05: un cierre por reemplazo (4001) no reconecta', () => {
  const s = new Socket();
  s.connect();
  FakeWS.all[0].serverOpen();
  FakeWS.all[0].serverClose(4001);
  mock.timers.tick(60_000);
  assert.equal(FakeWS.all.length, 1);
});

test('A03: frames que no son JSON u objetos no llegan a los listeners', () => {
  const s = new Socket();
  const got: unknown[] = [];
  s.on((m) => got.push(m));
  s.connect();
  const ws = FakeWS.all[0];
  ws.serverOpen();
  ws.onmessage?.({ data: 'no json' });
  ws.onmessage?.({ data: 'null' });
  ws.onmessage?.({ data: '[1,2]' });
  ws.onmessage?.({ data: '{"t":5}' });
  ws.serverSend({ t: 'host_back' });
  assert.deepEqual(got, [{ t: 'host_back' }]);
  s.close();
});
