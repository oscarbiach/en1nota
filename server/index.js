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

// Límites de recursos. Un servidor gratuito chico; ajustables por entorno.
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const MAX_ROOMS = num(process.env.MAX_ROOMS, 500);
const MAX_CONNECTIONS = num(process.env.MAX_CONNECTIONS, 2000);
/** Identidades por sala (jugadores, pantallas y quienes esperan aprobación). La UI usa hasta 8 jugadores. */
const MAX_PEERS_PER_ROOM = num(process.env.MAX_PEERS_PER_ROOM, 32);
/** Un celular desconectado hace más que esto deja de ocupar lugar en la sala. */
const PEER_TTL_MS = num(process.env.PEER_TTL_MS, 30 * 60 * 1000);
const SWEEP_MS = num(process.env.SWEEP_MS, 60 * 1000);
/**
 * Frecuencia por conexión (cubeta de fichas): mensajes por segundo y ráfaga.
 * Un celular manda pings y pulsaciones; el juez difunde el estado en cada
 * cambio, por eso tiene más margen.
 */
const RATE = { peer: { perSec: 10, burst: 20 }, host: { perSec: 100, burst: 200 } };
/** Mensajes descartados por frecuencia que se toleran antes de cortar la conexión. */
const RATE_CLOSE_AFTER = 100;

/** Métricas para /healthz. */
const stats = { started: Date.now(), rejected: { server_full: 0, room_full: 0, connections: 0, rate: 0, invalid: 0 } };

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
app.get('/healthz', (_req, res) => {
  let peers = 0;
  for (const r of rooms.values()) peers += r.peers.size;
  res.json({
    ok: true,
    rooms: rooms.size,
    peers,
    connections: wss.clients.size,
    uptimeS: Math.round((Date.now() - stats.started) / 1000),
    limits: { rooms: MAX_ROOMS, connections: MAX_CONNECTIONS, peersPerRoom: MAX_PEERS_PER_ROOM },
    rejected: stats.rejected
  });
});
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
  // Sin este handler, un error de protocolo de UN cliente (p. ej. un mensaje
  // que excede maxPayload) es un 'error' sin escuchar y termina el proceso.
  // ws ya cierra esa conexión; acá sólo evitamos que caiga el servidor.
  ws.on('error', () => {});
  if (wss.clients.size > MAX_CONNECTIONS) {
    stats.rejected.connections++;
    ws.close(1013, 'servidor lleno'); // 1013: probá más tarde
    return;
  }
  /** @type {{room?:string, pid?:string, isHost?:boolean}} */
  const me = {};
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Cubeta de fichas: cada mensaje gasta una; se recargan con el tiempo.
  const bucket = { tokens: RATE.peer.burst, last: Date.now(), dropped: 0 };
  const allowed = () => {
    const lim = me.isHost ? RATE.host : RATE.peer;
    const now = Date.now();
    bucket.tokens = Math.min(lim.burst, bucket.tokens + ((now - bucket.last) / 1000) * lim.perSec);
    bucket.last = now;
    if (bucket.tokens >= 1) { bucket.tokens -= 1; return true; }
    stats.rejected.rate++;
    if (++bucket.dropped >= RATE_CLOSE_AFTER) ws.close(1008, 'demasiados mensajes');
    return false;
  };
  const invalid = () => { stats.rejected.invalid++; };
  /** No se crean más salas que MAX_ROOMS. */
  const full = () => {
    if (rooms.size < MAX_ROOMS) return false;
    stats.rejected.server_full++;
    send(ws, { t: 'error', code: 'server_full' });
    return true;
  };

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
    if (!allowed()) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { invalid(); return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') { invalid(); return; }

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
          if (full()) return;
          room = newRoom(code, msg.key);
        } else {
          if (full()) return;
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
          if (full()) return;
          room = newRoom(code, null);
          armExpiry(room);
        }
        const resume = proven && !room.banned.has(msg.pid);
        const known = resume ? room.peers.get(msg.pid) : undefined;
        // Quien retoma su identidad siempre entra; los nuevos, hasta el máximo.
        if (!resume && room.peers.size >= MAX_PEERS_PER_ROOM) {
          stats.rejected.room_full++;
          send(ws, { t: 'error', code: 'room_full' });
          return;
        }
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
          if (!data) { invalid(); return; }
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
        if (!data) { invalid(); return; }
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

      default:
        invalid();
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
        p.goneAt = Date.now();
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

// Limpieza: identidades desconectadas hace más de PEER_TTL_MS dejan de ocupar
// lugar. Si vuelven con su secreto firmado, entran de nuevo igual.
setInterval(() => {
  const limit = Date.now() - PEER_TTL_MS;
  for (const room of rooms.values()) {
    for (const [pid, p] of room.peers) if (!p.ws && (p.goneAt ?? 0) < limit) room.peers.delete(pid);
  }
}, SWEEP_MS).unref();

server.listen(PORT, () => console.log(`En 1 Nota escuchando en http://0.0.0.0:${PORT}`));
