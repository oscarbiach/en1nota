// Regresión B02: el orden de pulsación lo decide la llegada al servidor, no
// la hora que declara el celular. HostConnection real con WebSocket simulado.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeWS {
  static OPEN = 1;
  static last: FakeWS;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeWS.last = this; }
  send(s: string) { this.sent.push(s); }
  close() {}
  open() { this.readyState = 1; this.onopen?.(); }
  push(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const g = globalThis as unknown as Record<string, unknown>;
const mem = new Map<string, string>();
g.WebSocket = FakeWS;
g.window = globalThis;
g.location = { protocol: 'http:', host: 'test.local' };
g.sessionStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) };

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
const { HostConnection } = await import('../src/net/host.ts');

function hostWithBuzzes() {
  const buzzes: Array<[string, number]> = [];
  const noop = () => {};
  const c = new HostConnection({
    onRoom: noop, onRoster: noop, onPeer: noop, onHello: noop, onRename: noop, onOnline: noop, onReplaced: noop,
    onBuzz: (pid, at) => buzzes.push([pid, at])
  });
  c.start();
  FakeWS.last.open();
  return { buzzes, ws: FakeWS.last, conn: c };
}

test('B02: una hora declarada antes no adelanta al jugador', () => {
  const { buzzes, ws, conn } = hostWithBuzzes();
  try {
    const t = 1_000_000;
    // Primero llega a las t; Segundo llega 30 ms después pero declara 1 s antes.
    ws.push({ t: 'msg', from: 'aaaaaaaaaaaa', data: { k: 'buzz', at: t, localAt: t }, at: t });
    ws.push({ t: 'msg', from: 'bbbbbbbbbbbb', data: { k: 'buzz', at: t - 1000, localAt: t - 1000 }, at: t + 30 });
    assert.deepEqual(buzzes, [['aaaaaaaaaaaa', t], ['bbbbbbbbbbbb', t + 30]]);
  } finally {
    conn.stop();
  }
});

test('B02: tampoco sirve declarar una hora futura ni un valor absurdo', () => {
  const { buzzes, ws, conn } = hostWithBuzzes();
  try {
    ws.push({ t: 'msg', from: 'aaaaaaaaaaaa', data: { k: 'buzz', at: 9e15 }, at: 500 });
    ws.push({ t: 'msg', from: 'aaaaaaaaaaaa', data: { k: 'buzz', at: -1 }, at: 600 });
    assert.deepEqual(buzzes.map(([, at]) => at), [500, 600]);
  } finally {
    conn.stop();
  }
});
