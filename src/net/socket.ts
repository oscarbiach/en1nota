// WebSocket con reconexión y reloj sincronizado con el servidor.
// Todos (juez y jugadores) comparan pulsaciones en "hora del servidor":
// offset = mediana de (s - (c + rtt/2)) sobre varios pings.
import type { ServerMsg } from './protocol.ts';
import { wsUrl } from './protocol.ts';

type Listener = (m: ServerMsg) => void;

/** El servidor cierra con 4000+ cuando la conexión fue reemplazada o expulsada: no reconectar. */
const FINAL_CLOSE_CODES = 4000;

export class Socket {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private openHandlers = new Set<() => void>();
  private closed = false;
  private retry = 0;
  private samples: number[] = [];
  private pingTimer?: number;
  private retryTimer?: number;
  private burstTimer?: number;
  offset = 0; // serverNow ≈ Date.now() + offset
  rtt = 0;
  online = false;
  onOnline?: (online: boolean) => void;

  connect() {
    this.closed = false;
    this.open();
  }

  private open() {
    if (this.closed) return;
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    // Cada callback comprueba que su socket siga siendo el vigente: un socket
    // anterior (o uno cerrado por close()) nunca llega a las vistas.
    const current = () => !this.closed && this.ws === ws;
    ws.onopen = () => {
      if (!current()) return;
      this.retry = 0;
      this.online = true;
      this.onOnline?.(true);
      this.samples = [];
      this.syncClock();
      this.openHandlers.forEach((h) => h());
    };
    ws.onmessage = (ev) => {
      if (!current()) return;
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      if (m.t === 'pong') { if (typeof m.c === 'number' && typeof m.s === 'number') this.onPong(m.c, m.s); return; }
      this.listeners.forEach((l) => l(m));
    };
    ws.onclose = (ev) => {
      if (!current()) return;
      this.stopTimers();
      this.online = false;
      this.onOnline?.(false);
      if (ev.code >= FINAL_CLOSE_CODES) { this.closed = true; return; }
      const wait = Math.min(8000, 500 * 2 ** this.retry++);
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = undefined;
        this.open();
      }, wait);
    };
    ws.onerror = () => ws.close();
  }

  private stopTimers() {
    clearInterval(this.pingTimer);
    clearTimeout(this.burstTimer);
    clearTimeout(this.retryTimer);
    this.pingTimer = this.burstTimer = this.retryTimer = undefined;
  }

  private syncClock() {
    let n = 0;
    const burst = () => {
      this.ping();
      if (++n < 6) this.burstTimer = window.setTimeout(burst, 150);
    };
    burst();
    clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.ping(), 10000);
  }

  private ping() {
    this.raw({ t: 'ping', c: Date.now() });
  }

  private onPong(c: number, s: number) {
    const now = Date.now();
    const rtt = now - c;
    const off = s - (c + rtt / 2);
    this.rtt = rtt;
    this.samples.push(off);
    if (this.samples.length > 9) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.offset = sorted[Math.floor(sorted.length / 2)];
  }

  serverNow(): number {
    return Date.now() + this.offset;
  }

  raw(obj: unknown) {
    if (!this.closed && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onOpen(h: () => void) {
    this.openHandlers.add(h);
    if (this.online) h();
    return () => this.openHandlers.delete(h);
  }

  close() {
    this.closed = true;
    this.online = false;
    this.stopTimers();
    const ws = this.ws;
    this.ws = undefined;
    try { ws?.close(); } catch { /* ya cerrado */ }
  }
}
