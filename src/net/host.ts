// Lado juez de la sala: crea/retoma la sala, recibe pulsaciones y difunde el estado público.
import { Socket } from './socket.ts';
import type { HostMsg, PeerInfo, SfxName } from './protocol.ts';
import type { PublicState } from '../game/types.ts';
import { parsePeerMsg } from './validate.ts';

const KEY_ROOM = 'en1nota.room';

export interface HostEvents {
  /** Sala confirmada. `previous` es la que tenía antes si cambió (p. ej. el servidor se reinició sin ROOM_SECRET). */
  onRoom: (room: string, previous?: string) => void;
  /** Lista completa de conexiones de la sala al (re)conectarse el juez. */
  onRoster: (peers: PeerInfo[]) => void;
  onPeer: (p: PeerInfo) => void;
  onHello: (pid: string, role: 'player' | 'screen', name: string) => void;
  onRename: (pid: string, name: string) => void;
  onBuzz: (pid: string, at: number) => void;
  onOnline: (online: boolean) => void;
  /** Otra pestaña o dispositivo tomó esta sala con su clave. */
  onReplaced: () => void;
}

export class HostConnection {
  readonly socket = new Socket();
  room?: string;
  private key?: string;
  private lastState?: PublicState;
  /** Sala que teníamos antes de un `bad_key`, para avisar si cambió el código. */
  private lostRoom?: string;
  private ev: HostEvents;

  constructor(ev: HostEvents) {
    this.ev = ev;
  }

  start() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY_ROOM) ?? 'null') as { room: string; key: string } | null;
      if (saved) { this.room = saved.room; this.key = saved.key; }
    } catch { /* nada */ }
    this.socket.onOnline = (o) => this.ev.onOnline(o);
    this.socket.onOpen(() => this.socket.raw({ t: 'host', room: this.room, key: this.key }));
    this.socket.on((m) => {
      switch (m.t) {
        case 'hosted': {
          const previous = this.lostRoom && this.lostRoom !== m.room ? this.lostRoom : undefined;
          this.lostRoom = undefined;
          this.room = m.room; this.key = m.key;
          try { sessionStorage.setItem(KEY_ROOM, JSON.stringify({ room: m.room, key: m.key })); } catch { /* sin storage */ }
          this.ev.onRoom(m.room, previous);
          this.ev.onRoster(m.peers);
          if (this.lastState) this.broadcastState(this.lastState);
          break;
        }
        case 'peer':
          this.ev.onPeer(m);
          if (m.connected && this.lastState) this.sendTo(m.pid, { k: 'state', state: this.lastState, serverNow: this.socket.serverNow() });
          break;
        case 'host_replaced':
          // El servidor ya no acepta nada de esta conexión: no reintentar.
          this.socket.close();
          this.ev.onReplaced();
          break;
        case 'msg': {
          const d = parsePeerMsg(m.data);
          if (!d || typeof m.from !== 'string') break;
          if (d.k === 'hello') this.ev.onHello(m.from, d.role, d.name);
          else if (d.k === 'rename') this.ev.onRename(m.from, d.name);
          else if (d.k === 'buzz') {
            // Preferimos el reloj sincronizado del jugador; si parece roto, usamos la llegada al servidor.
            const arrival = typeof m.at === 'number' ? m.at : this.socket.serverNow();
            const at = Number.isFinite(d.at) && Math.abs(d.at - arrival) < 2000 ? d.at : arrival;
            this.ev.onBuzz(m.from, at);
          }
          break;
        }
        case 'error':
          if (m.code === 'bad_key') {
            // La sala ya no existe y no se pudo recuperar: pedimos una nueva.
            this.lostRoom = this.room;
            this.room = undefined; this.key = undefined;
            try { sessionStorage.removeItem(KEY_ROOM); } catch { /* sin storage */ }
            this.socket.raw({ t: 'host' });
          }
          break;
      }
    });
    this.socket.connect();
  }

  sendTo(pid: string, msg: HostMsg) {
    this.socket.raw({ t: 'msg', to: pid, data: msg });
  }

  broadcast(msg: HostMsg) {
    this.socket.raw({ t: 'msg', to: 'all', data: msg });
  }

  broadcastState(state: PublicState) {
    this.lastState = state;
    this.broadcast({ k: 'state', state, serverNow: this.socket.serverNow() });
  }

  sfx(name: SfxName, playerId?: string) {
    this.broadcast({ k: 'sfx', name, playerId });
  }

  kick(pid: string) {
    this.socket.raw({ t: 'kick', pid });
  }

  closeRoom() {
    this.socket.raw({ t: 'close_room' });
    sessionStorage.removeItem(KEY_ROOM);
    this.socket.close();
  }

  stop() {
    this.socket.close();
  }
}
