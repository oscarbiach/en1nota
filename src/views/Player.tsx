import { useEffect, useRef, useState } from 'react';
import { PeerConnection, type PeerStatus } from '../net/peer';
import type { HostMsg } from '../net/protocol';
import type { PublicState } from '../game/types';
import { loadPlayerName, savePlayerName } from '../storage/store';
import { playSfx, unlockAudio } from '../audio/sfx';
import { RevealCard } from '../components/RevealCard';
import { navigate } from '../App';

const STATUS_TEXT: Record<PeerStatus, string> = {
  connecting: 'Conectando…',
  joined: 'Conectado',
  no_room: 'Esa sala no existe. Revisá el código.',
  host_gone: 'El juez se desconectó, esperando…',
  kicked: 'El juez te sacó de la sala.',
  closed: 'La sala se cerró.',
  offline: 'Sin conexión, reintentando…'
};

export function PlayerView({ room }: { room: string }) {
  const [name, setName] = useState(loadPlayerName());
  const [entered, setEntered] = useState(!!loadPlayerName() && room.length === 4);
  if (!entered) {
    return (
      <div className="center">
        <div className="card" style={{ width: 'min(420px, 100%)' }}>
          <h2>Sala {room || '?'}</h2>
          <div className="field"><label>Tu nombre</label><input aria-label="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus /></div>
          <button className="btn primary block xl" disabled={!name.trim() || room.length !== 4} onClick={() => { savePlayerName(name.trim()); unlockAudio(); setEntered(true); }}>Entrar</button>
          <button className="btn ghost block mt" onClick={() => navigate('/')}>Volver</button>
        </div>
      </div>
    );
  }
  return <Buzzer room={room} name={name.trim()} />;
}

function Buzzer({ room, name }: { room: string; name: string }) {
  const [status, setStatus] = useState<PeerStatus>('connecting');
  const [me, setMe] = useState<{ playerId: string; color: string } | null>(null);
  const [state, setState] = useState<PublicState | null>(null);
  const [rejected, setRejected] = useState<string>();
  const conn = useRef<PeerConnection>(null);
  const lastBuzz = useRef(0);

  useEffect(() => {
    const c = new PeerConnection(room, 'player', name, {
      onStatus: setStatus,
      onHost: (m: HostMsg) => {
        if (m.k === 'state') setState(m.state);
        else if (m.k === 'welcome') setMe({ playerId: m.playerId, color: m.color });
        else if (m.k === 'rejected') setRejected(m.reason);
        else if (m.k === 'sfx') {
          // Cada celu suena solo con su propio pulsador; el resto lo pone la TV o el juez.
          if (m.name === 'buzz') { if (m.playerId === conn.current?.pid) playSfx('buzz', 0); }
          else if (m.name === 'correct' || m.name === 'wrong' || m.name === 'hum') {
            if (state?.buzzedPlayerId === conn.current?.pid || m.playerId === conn.current?.pid) playSfx(m.name);
          }
        }
      }
    });
    conn.current = c;
    c.start();
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, name]);

  const myId = me?.playerId ?? conn.current?.pid;
  const mine = state?.players.find((p) => p.id === myId);
  const color = mine?.color ?? me?.color ?? '#888';
  const locked = !!myId && !!state?.lockedPlayerIds.includes(myId);
  const open = state?.phase === 'playing' || state?.phase === 'open';
  const canBuzz = open && !locked && !!mine && status === 'joined';
  const hasFloor = state?.buzzedPlayerId && state.buzzedPlayerId === myId;
  const other = state?.buzzedPlayerId ? state.players.find((p) => p.id === state.buzzedPlayerId) : undefined;

  const buzz = () => {
    const now = Date.now();
    if (!canBuzz || now - lastBuzz.current < 300) return;
    lastBuzz.current = now;
    unlockAudio();
    conn.current?.buzz();
    try { navigator.vibrate?.(60); } catch { /* sin vibración */ }
  };

  let label: string;
  let sub = '';
  let cls = 'off';
  if (rejected) { label = 'Sin lugar'; sub = rejected; }
  else if (status !== 'joined') { label = '…'; sub = STATUS_TEXT[status]; }
  else if (!mine) { label = 'Esperando'; sub = 'El juez todavía no te agregó'; }
  else if (state?.phase === 'lobby') { label = 'Listo'; sub = 'Esperando que arranque la partida'; }
  else if (state?.phase === 'finished') { label = 'Fin'; sub = 'Mirá el resultado en la tele'; }
  else if (state?.phase === 'revealed') { label = '🎵'; sub = state.solvedBy === myId ? '¡La sacaste!' : 'Ahí está la canción'; }
  else if (hasFloor) { label = '¡Tuya!'; sub = 'Decí el nombre exacto o cantá la letra'; cls = 'mine'; }
  else if (other) { label = other.name; sub = 'tiene la palabra'; }
  else if (locked) { label = 'Bloqueado'; sub = 'Ya fallaste en este tema'; }
  else if (open) { label = '¡TOCÁ!'; sub = state?.phase === 'playing' ? 'Sonando…' : '¿La sabés?'; cls = ''; }
  else { label = 'Atenti'; sub = 'El juez está por poner el tema'; }

  return (
    <div className="buzzer" style={{ ['--c' as string]: color }}>
      <div className="top">
        <span style={{ color }}>{mine?.name ?? name}</span>
        <span className={`pill ${status === 'joined' ? 'on' : 'off'}`}>{room}</span>
        <span style={{ fontSize: '1.4rem', color: (mine?.score ?? 0) < 0 ? 'var(--bad)' : undefined }}>{mine?.score ?? 0}</span>
      </div>
      {state?.phase === 'revealed' && state.revealed ? (
        <div className="grow col" style={{ justifyContent: 'center', alignItems: 'center' }}>
          <RevealCard revealed={state.revealed} />
          <div className="big fade" style={{ fontWeight: 800, color: state.solvedBy === myId ? 'var(--ok)' : 'var(--muted)' }}>
            {state.solvedBy === myId ? '¡La sacaste!' : state.solvedBy ? `La sacó ${state.players.find((p) => p.id === state.solvedBy)?.name ?? ''}` : 'Nadie la sacó'}
          </div>
        </div>
      ) : (
        <button className={`bigbtn ${cls}`} onPointerDown={buzz} disabled={!canBuzz && !hasFloor}>
          <span>{label}</span>
          <small>{sub}</small>
        </button>
      )}
      <div className="row between small muted">
        <span>{state ? `Tema ${state.trackIndex + 1}/${state.trackCount}` : ''}</span>
        <span>{state?.notice ?? ''}</span>
        <button className="btn sm ghost" onClick={() => navigate('/')}>Salir</button>
      </div>
    </div>
  );
}
