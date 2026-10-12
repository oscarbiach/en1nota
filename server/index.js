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

/**
 * Las credenciales son firmas HMAC con este secreto, así el servidor las
 * puede verificar aunque se haya reiniciado y perdido las salas en memoria
 * (B09). Con ROOM_SECRET fijo, tras un reinicio el juez recupera el mismo
 * código y cada celular su puesto. Sin él, se genera uno por proceso: todo
 * funciona, pero un reinicio obliga a reincorporar a los jugadores a mano.
 */
const SECRET = process.env.ROOM_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.ROOM_SECRET) {
  console.warn('ROOM_SECRET no definido: tras un reinicio del servidor las salas no se recuperan solas.');
}
const mac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);

/** Clave de juez: nonce (16 hex) + firma (32 hex). El nonce distingue cada vida de un código. */
function newHostKey(code) {
  const nonce = crypto.randomBytes(8).toString('hex');
  return nonce + mac(`host:${code}:${nonce}`);
}
function validHostKey(code, key) {
  return isKey(key) && safeEqual(key.slice(16), mac(`host:${code}:${key.slice(0, 16)}`));
}
/** Secreto de un celular o pantalla: ata sala, rol y pid. Nunca se difunde. */
const peerSecret = (code, role, pid) => mac(`peer:${code}:${role}:${pid}`);

const app = express();
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(DIST, { index: 'index.html', maxAge: '1h' }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_PAYLOAD });

/**
 * `pid` es público (viaja en el estado de la partida); su secreto sólo lo
 * conoce la conexión que lo recibió y es lo que autoriza a retomar ese pid.
 * `key` es null en una sala recreada por un celular tras un reinicio, hasta
 * que vuelve el juez con una clave firmada para ese código.
 * @type {Map<string, {code:string, key:string|null, host:import('ws').WebSocket|null, peers:Map<string, {ws:import('ws').WebSocket|null, role:string, name:string}>, banned:Set<string>, expiry:NodeJS.Timeout|null}>}
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

function newRoom(code, key) {
  const room = { code, key, host: null, peers: new Map(), banned: new Set(), expiry: null };
  rooms.set(code, room);
  return room;
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
        if (room) {
          // Sala viva: hace falta su clave exacta. Sala recreada por un
          // celular tras un reinicio: basta una clave firmada para ese código.
          const ok = room.key ? isKey(msg.key) && safeEqual(room.key, msg.key) : validHostKey(room.code, msg.key);
          if (!ok) { send(ws, { t: 'error', code: 'bad_key' }); return; }
          room.key ??= msg.key;
        } else if (code && msg.key !== undefined) {
          // La sala no existe (p. ej. el servidor se reinició): se recupera
          // con el mismo código sólo si la clave está firmada por nosotros.
          if (!validHostKey(code, msg.key)) { send(ws, { t: 'error', code: 'bad_key' }); return; }
          room = newRoom(code, msg.key);
        } else {
          const c = newCode();
          room = newRoom(c, newHostKey(c));
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
        const role = msg.role === 'screen' ? 'screen' : 'player';
        // Retomar un pid exige su secreto firmado (ata sala, rol y pid); si no
        // coincide, es otra identidad. Así A04 sigue cerrado tras un reinicio.
        const proven = !!code && isId(msg.pid) && isSecret(msg.secret) && safeEqual(msg.secret, peerSecret(code, role, msg.pid));
        let room = code ? rooms.get(code) : undefined;
        if (!room) {
          // Tras un reinicio, un celular con identidad válida espera al juez
          // en la misma sala en vez de quedar en "esa sala no existe".
          if (!proven) { send(ws, { t: 'error', code: 'no_room' }); return; }
          room = newRoom(code, null);
          armExpiry(room);
        }
        const resume = proven && !room.banned.has(msg.pid);
        const known = resume ? room.peers.get(msg.pid) : undefined;
        const pid = resume ? msg.pid : crypto.randomBytes(6).toString('hex');
        const secret = peerSecret(room.code, role, pid);
        const prevWs = known?.ws ?? null;
        const name = cleanName(msg.name) || known?.name || '';
        room.peers.set(pid, { ws, role, name });
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
        // El secreto firmado sigue siendo válido: lo vetamos en esta sala para
        // que al recargar entre como alguien nuevo, igual que antes.
        room.banned.add(msg.pid);
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
