// Servidor de salas de "En 1 Nota".
// Sirve la PWA compilada (dist/) y relaya mensajes WebSocket entre el juez
// (host) y los jugadores / pantallas de una sala. No tiene lógica de juego:
// toda la partida vive en el navegador del juez.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.join(__dirname, '..', 'dist');
const ROOM_TTL_MS = 10 * 60 * 1000; // sala viva 10 min sin juez

const app = express();
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(DIST, { index: 'index.html', maxAge: '1h' }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, {code:string, key:string, host:import('ws').WebSocket|null, peers:Map<string, {ws:import('ws').WebSocket|null, role:string, name:string}>, expiry:NodeJS.Timeout|null}>} */
const rooms = new Map();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundir
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function roster(room) {
  return [...room.peers.entries()].map(([pid, p]) => ({
    pid, role: p.role, name: p.name, connected: !!p.ws
  }));
}

function armExpiry(room) {
  if (room.expiry) clearTimeout(room.expiry);
  room.expiry = setTimeout(() => {
    for (const p of room.peers.values()) send(p.ws, { t: 'room_closed' });
    rooms.delete(room.code);
  }, ROOM_TTL_MS);
}

wss.on('connection', (ws) => {
  /** @type {{room?:string, pid?:string, isHost?:boolean}} */
  const me = {};
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong', c: msg.c, s: Date.now() });
        return;

      case 'host': {
        // Crea una sala nueva o retoma una existente con su clave.
        let room = msg.room && rooms.get(String(msg.room).toUpperCase());
        if (room && room.key !== msg.key) { send(ws, { t: 'error', code: 'bad_key' }); return; }
        if (!room) {
          room = { code: newCode(), key: crypto.randomBytes(12).toString('hex'), host: null, peers: new Map(), expiry: null };
          rooms.set(room.code, room);
        }
        if (room.host && room.host !== ws) send(room.host, { t: 'host_replaced' });
        room.host = ws;
        if (room.expiry) { clearTimeout(room.expiry); room.expiry = null; }
        me.room = room.code; me.isHost = true;
        send(ws, { t: 'hosted', room: room.code, key: room.key, peers: roster(room) });
        for (const p of room.peers.values()) send(p.ws, { t: 'host_back' });
        return;
      }

      case 'join': {
        const room = rooms.get(String(msg.room || '').toUpperCase());
        if (!room) { send(ws, { t: 'error', code: 'no_room' }); return; }
        const role = msg.role === 'screen' ? 'screen' : 'player';
        let pid = typeof msg.pid === 'string' && room.peers.has(msg.pid) ? msg.pid : null;
        if (!pid) pid = crypto.randomBytes(6).toString('hex');
        const prev = room.peers.get(pid);
        if (prev && prev.ws && prev.ws !== ws) send(prev.ws, { t: 'replaced' });
        const name = String(msg.name || prev?.name || '').slice(0, 24);
        room.peers.set(pid, { ws, role, name });
        me.room = room.code; me.pid = pid; me.isHost = false;
        send(ws, { t: 'joined', room: room.code, pid, hostOnline: !!room.host });
        send(room.host, { t: 'peer', pid, role, name, connected: true });
        return;
      }

      case 'msg': {
        const room = me.room && rooms.get(me.room);
        if (!room) return;
        if (me.isHost) {
          if (msg.to === 'all') {
            for (const p of room.peers.values()) send(p.ws, { t: 'msg', data: msg.data });
          } else if (typeof msg.to === 'string') {
            const p = room.peers.get(msg.to);
            if (p) send(p.ws, { t: 'msg', data: msg.data });
          }
        } else {
          send(room.host, { t: 'msg', from: me.pid, data: msg.data, at: Date.now() });
        }
        return;
      }

      case 'kick': {
        const room = me.room && rooms.get(me.room);
        if (!room || !me.isHost) return;
        const p = room.peers.get(msg.pid);
        if (p) { send(p.ws, { t: 'kicked' }); room.peers.delete(msg.pid); try { p.ws?.close(); } catch {} }
        return;
      }

      case 'close_room': {
        const room = me.room && rooms.get(me.room);
        if (!room || !me.isHost) return;
        for (const p of room.peers.values()) send(p.ws, { t: 'room_closed' });
        rooms.delete(room.code);
        return;
      }
    }
  });

  ws.on('close', () => {
    const room = me.room && rooms.get(me.room);
    if (!room) return;
    if (me.isHost) {
      if (room.host === ws) {
        room.host = null;
        for (const p of room.peers.values()) send(p.ws, { t: 'host_gone' });
        armExpiry(room);
      }
    } else if (me.pid) {
      const p = room.peers.get(me.pid);
      if (p && p.ws === ws) {
        p.ws = null;
        send(room.host, { t: 'peer', pid: me.pid, role: p.role, name: p.name, connected: false });
      }
    }
  });
});

// Mantiene vivas las conexiones detrás de proxies.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`En 1 Nota escuchando en http://0.0.0.0:${PORT}`));
