// Lado jugador / pantalla: se une a una sala y recibe el estado público.
import { Socket } from './socket';
import type { HostMsg, PeerMsg } from './protocol';
import { parseHostMsg } from './validate';

const KEY_ID = 'en1nota.identity';

export type PeerStatus = 'connecting' | 'joined' | 'no_room' | 'room_full' | 'host_gone' | 'kicked' | 'closed' | 'replaced' | 'offline';

export interface PeerEvents {
  onStatus: (s: PeerStatus) => void;
  onHost: (m: HostMsg) => void;
}

/** pid (público) + secreto (privado) para retomar la misma identidad al recargar. */
interface Identity { pid: string; secret: string }

function loadIdentity(room: string): Identity | undefined {
  try {
    const v = JSON.parse(sessionStorage.getItem(`${KEY_ID}.${room}`) ?? 'null');
    return v && typeof v.pid === 'string' && typeof v.secret === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export class PeerConnection {
  readonly socket = new Socket();
  pid?: string;
  private secret?: string;
  private room: string;
  private role: 'player' | 'screen';
  private name: string;
  private ev: PeerEvents;

  constructor(room: string, role: 'player' | 'screen', name: string, ev: PeerEvents) {
    this.room = room;
    this.role = role;
    this.name = name;
    this.ev = ev;
  }

  start() {
    const saved = loadIdentity(this.room);
    this.pid = saved?.pid;
    this.secret = saved?.secret;
    this.socket.onOnline = (o) => { if (!o) this.ev.onStatus('offline'); };
    this.socket.onOpen(() => {
      this.ev.onStatus('connecting');
      this.socket.raw({ t: 'join', room: this.room, role: this.role, name: this.name, pid: this.pid, secret: this.secret });
    });
    this.socket.on((m) => {
      switch (m.t) {
        case 'joined':
          this.pid = m.pid;
          this.secret = m.secret;
          try { sessionStorage.setItem(`${KEY_ID}.${this.room}`, JSON.stringify({ pid: m.pid, secret: m.secret })); } catch { /* sin storage */ }
          this.ev.onStatus(m.hostOnline ? 'joined' : 'host_gone');
          this.send({ k: 'hello', role: this.role, name: this.name });
          break;
        case 'msg': {
          const d = parseHostMsg(m.data);
          if (d) this.ev.onHost(d);
          break;
        }
        case 'error':
          if (m.code === 'no_room') { this.ev.onStatus('no_room'); this.socket.close(); }
          else if (m.code === 'room_full') { this.ev.onStatus('room_full'); this.socket.close(); }
          break;
        case 'host_gone': this.ev.onStatus('host_gone'); break;
        case 'host_back': this.ev.onStatus('joined'); this.send({ k: 'hello', role: this.role, name: this.name }); break;
        case 'kicked': this.ev.onStatus('kicked'); this.socket.close(); break;
        case 'room_closed': this.ev.onStatus('closed'); this.socket.close(); break;
        case 'replaced': this.ev.onStatus('replaced'); this.socket.close(); break;
      }
    });
    this.socket.connect();
  }

  send(msg: PeerMsg) {
    this.socket.raw({ t: 'msg', data: msg });
  }

  buzz() {
    this.send({ k: 'buzz', at: this.socket.serverNow(), localAt: Date.now() });
  }

  rename(name: string) {
    this.name = name;
    this.send({ k: 'rename', name });
  }

  stop() {
    this.socket.close();
  }
}
