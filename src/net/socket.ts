// WebSocket con reconexión y reloj sincronizado con el servidor.
// Todos (juez y jugadores) comparan pulsaciones en "hora del servidor":
// offset = mediana de (s - (c + rtt/2)) sobre varios pings.
import type { ServerMsg } from './protocol';
import { wsUrl } from './protocol';

type Listener = (m: ServerMsg) => void;

export class Socket {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private openHandlers = new Set<() => void>();
  private closed = false;
  private retry = 0;
  private samples: number[] = [];
  private pingTimer?: number;
  offset = 0; // serverNow ≈ Date.now() + offset
  rtt = 0;
  online = false;
  onOnline?: (online: boolean) => void;

  connect() {
    this.closed = false;
    this.open();
  }

  private open() {
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.online = true;
      this.onOnline?.(true);
      this.samples = [];
      this.syncClock();
      this.openHandlers.forEach((h) => h());
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'pong') { this.onPong(m.c, m.s); return; }
      this.listeners.forEach((l) => l(m));
    };
    ws.onclose = () => {
      this.online = false;
      this.onOnline?.(false);
      clearInterval(this.pingTimer);
      if (this.closed) return;
      const wait = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), wait);
    };
    ws.onerror = () => ws.close();
  }

  private syncClock() {
    let n = 0;
    const burst = () => { this.ping(); if (++n < 6) setTimeout(burst, 150); };
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
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
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
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
