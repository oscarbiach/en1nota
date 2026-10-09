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
import { cleanName, cleanRoom, hostData, isId, isKey, isSecret, peerData } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.join(__dirname, '..', 'dist');
const ROOM_TTL_MS = 10 * 60 * 1000; // sala viva 10 min sin juez
const MAX_PAYLOAD = 64 * 1024; // un estado público con 8 jugadores ocupa ~3 KB
/** Código de cierre para conexiones reemplazadas: el cliente no debe reconectar. */
const CLOSE_REPLACED = 4001;

const app = express();
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(DIST, { index: 'index.html', maxAge: '1h' }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD });

/**
 * `pid` es público (viaja en el estado de la partida); `secret` sólo lo
 * conoce la conexión que lo recibió y es lo que autoriza a retomar ese pid.
 * @type {Map<string, {code:string, key:string, host:import('ws').WebSocket|null, peers:Map<string, {ws:import('ws').WebSocket|null, role:string, name:string, secret:string}>, expiry:NodeJS.Timeout|null}>}
 */
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

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Avisa a una conexión desplazada y la cierra: deja de tener autoridad. */
function revoke(ws, t) {
  if (!ws) return;
  send(ws, { t });
  try { ws.close(CLOSE_REPLACED, t); } catch { /* ya cerrada */ }
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
  // Sin este handler, un error de protocolo de UN cliente (p. ej. un mensaje
  // que excede maxPayload) es un 'error' sin escuchar y termina el proceso.
  // ws ya cierra esa conexión; acá sólo evitamos que caiga el servidor.
  ws.on('error', () => {});

  /** Sala de esta conexión sólo si sigue siendo su juez vigente. */
  const hostRoom = () => {
    const room = me.room && me.isHost ? rooms.get(me.room) : undefined;
    return room && room.host === ws ? room : undefined;
  };
  /** Sala y registro de esta conexión sólo si sigue siendo la dueña de su pid. */
  const peerEntry = () => {
    const room = me.room && !me.isHost ? rooms.get(me.room) : undefined;
    const p = room && me.pid ? room.peers.get(me.pid) : undefined;
    return room && p && p.ws === ws ? { room, p } : undefined;
  };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong', c: typeof msg.c === 'number' && Number.isFinite(msg.c) ? msg.c : 0, s: Date.now() });
        return;

      case 'host': {
        // Una conexión tiene un único rol y una única sala durante su vida.
        if (me.room) { send(ws, { t: 'error', code: 'already_bound' }); return; }
        // Crea una sala nueva o retoma una existente con su clave.
        const code = cleanRoom(msg.room);
        let room = code ? rooms.get(code) : undefined;
        if (room && !(isKey(msg.key) && safeEqual(room.key, msg.key))) { send(ws, { t: 'error', code: 'bad_key' }); return; }
        if (!room) {
          room = { code: newCode(), key: crypto.randomBytes(12).toString('hex'), host: null, peers: new Map(), expiry: null };
          rooms.set(room.code, room);
        }
        const prev = room.host;
        room.host = ws;
        if (prev && prev !== ws) revoke(prev, 'host_replaced');
        if (room.expiry) { clearTimeout(room.expiry); room.expiry = null; }
        me.room = room.code; me.isHost = true;
        send(ws, { t: 'hosted', room: room.code, key: room.key, peers: roster(room) });
        for (const p of room.peers.values()) send(p.ws, { t: 'host_back' });
        return;
      }

      case 'join': {
        if (me.room) { send(ws, { t: 'error', code: 'already_bound' }); return; }
        const code = cleanRoom(msg.room);
        const room = code ? rooms.get(code) : undefined;
        if (!room) { send(ws, { t: 'error', code: 'no_room' }); return; }
        const role = msg.role === 'screen' ? 'screen' : 'player';
        // Retomar un pid exige su secreto; si no coincide, es otra identidad.
        const known = isId(msg.pid) ? room.peers.get(msg.pid) : undefined;
        const resume = known && known.role === role && isSecret(msg.secret) && safeEqual(known.secret, msg.secret);
        const pid = resume ? msg.pid : crypto.randomBytes(6).toString('hex');
        const secret = resume ? known.secret : crypto.randomBytes(16).toString('hex');
        const prevWs = resume ? known.ws : null;
        const name = cleanName(msg.name) || (resume ? known.name : '');
        room.peers.set(pid, { ws, role, name, secret });
        if (prevWs && prevWs !== ws) revoke(prevWs, 'replaced');
        me.room = room.code; me.pid = pid; me.isHost = false;
        send(ws, { t: 'joined', room: room.code, pid, secret, hostOnline: !!room.host });
        send(room.host, { t: 'peer', pid, role, name, connected: true });
        return;
      }

      case 'msg': {
        const room = hostRoom();
        if (room) {
          const data = hostData(msg.data);
          if (!data) return;
          if (msg.to === 'all') {
            for (const p of room.peers.values()) send(p.ws, { t: 'msg', data });
          } else if (isId(msg.to)) {
            const p = room.peers.get(msg.to);
            if (p) send(p.ws, { t: 'msg', data });
          }
          return;
        }
        const entry = peerEntry();
        if (!entry) return;
        const data = peerData(msg.data, entry.p.role);
        if (!data) return;
        send(entry.room.host, { t: 'msg', from: me.pid, data, at: Date.now() });
        return;
      }

      case 'kick': {
        const room = hostRoom();
        if (!room || !isId(msg.pid)) return;
        const p = room.peers.get(msg.pid);
        if (p) { room.peers.delete(msg.pid); revoke(p.ws, 'kicked'); }
        return;
      }

      case 'close_room': {
        const room = hostRoom();
        if (!room) return;
        for (const p of room.peers.values()) send(p.ws, { t: 'room_closed' });
        if (room.expiry) clearTimeout(room.expiry);
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
