// Lado jugador / pantalla: se une a una sala y recibe el estado público.
import { Socket } from './socket';
import type { HostMsg, PeerMsg } from './protocol';

const KEY_PID = 'en1nota.pid';

export type PeerStatus = 'connecting' | 'joined' | 'no_room' | 'host_gone' | 'kicked' | 'closed' | 'offline';

export interface PeerEvents {
  onStatus: (s: PeerStatus) => void;
  onHost: (m: HostMsg) => void;
}

export class PeerConnection {
  readonly socket = new Socket();
  pid?: string;

  constructor(private room: string, private role: 'player' | 'screen', private name: string, private ev: PeerEvents) {}

  start() {
    this.pid = sessionStorage.getItem(`${KEY_PID}.${this.room}`) ?? undefined;
    this.socket.onOnline = (o) => { if (!o) this.ev.onStatus('offline'); };
    this.socket.onOpen(() => {
      this.ev.onStatus('connecting');
      this.socket.raw({ t: 'join', room: this.room, role: this.role, name: this.name, pid: this.pid });
    });
    this.socket.on((m) => {
      switch (m.t) {
        case 'joined':
          this.pid = m.pid;
          sessionStorage.setItem(`${KEY_PID}.${this.room}`, m.pid);
          this.ev.onStatus(m.hostOnline ? 'joined' : 'host_gone');
          this.send({ k: 'hello', role: this.role, name: this.name });
          break;
        case 'msg':
          this.ev.onHost(m.data as HostMsg);
          break;
        case 'error':
          if (m.code === 'no_room') { this.ev.onStatus('no_room'); this.socket.close(); }
          break;
        case 'host_gone': this.ev.onStatus('host_gone'); break;
        case 'host_back': this.ev.onStatus('joined'); this.send({ k: 'hello', role: this.role, name: this.name }); break;
        case 'kicked': this.ev.onStatus('kicked'); this.socket.close(); break;
        case 'room_closed': this.ev.onStatus('closed'); this.socket.close(); break;
        case 'replaced': this.ev.onStatus('closed'); this.socket.close(); break;
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
