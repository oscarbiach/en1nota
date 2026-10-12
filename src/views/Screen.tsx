import { useEffect, useRef, useState } from 'react';
import { PeerConnection, type PeerStatus } from '../net/peer';
import type { HostMsg } from '../net/protocol';
import type { FinalResult, PublicState } from '../game/types';
import { rankStandings } from '../game/engine';
import { FinalStandings, type StandingEntry } from '../components/FinalStandings';
import { playSfx, unlockAudio } from '../audio/sfx';
import { Scoreboard } from '../components/Scoreboard';
import { RevealCard } from '../components/RevealCard';
import { RoomQr } from '../components/RoomQr';
import { joinUrl } from '../net/protocol';
import { secs } from '../util/format';

export function ScreenView({ room }: { room: string }) {
  const [armed, setArmed] = useState(false);
  const [status, setStatus] = useState<PeerStatus>('connecting');
  const [state, setState] = useState<PublicState | null>(null);
  const conn = useRef<PeerConnection>(null);

  useEffect(() => {
    if (!armed) return;
    const c = new PeerConnection(room, 'screen', 'TV', {
      onStatus: setStatus,
      onHost: (m: HostMsg) => {
        if (m.k === 'state') setState(m.state);
        else if (m.k === 'sfx') {
          const idx = m.playerId ? Math.max(0, (stateRef.current?.players.findIndex((p) => p.id === m.playerId) ?? 0)) : 0;
          playSfx(m.name, idx);
        }
      }
    });
    conn.current = c;
    c.start();
    return () => c.stop();
  }, [armed, room]);

  const stateRef = useRef<PublicState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'f') document.documentElement.requestFullscreen?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!armed) {
    return (
      <div className="overlay">
        <div>
          <div className="huge" style={{ color: 'var(--accent)' }}>En 1 Nota</div>
          <p className="muted">Sala {room}. Tocá para activar el sonido de la pantalla.</p>
          <button className="btn primary xl" onClick={() => { unlockAudio(); setArmed(true); document.documentElement.requestFullscreen?.().catch(() => {}); }}>Activar pantalla</button>
        </div>
      </div>
    );
  }

  const floor = state?.buzzedPlayerId ? state.players.find((p) => p.id === state.buzzedPlayerId) : undefined;
  const solver = state?.solvedBy ? state.players.find((p) => p.id === state.solvedBy)?.name : undefined;

  return (
    <div className="tv">
      <header>
        <span style={{ color: 'var(--accent)' }}>En 1 Nota</span>
        <span className="muted">
          {state && state.phase !== 'lobby' && state.phase !== 'finished' ? `Tema ${state.trackIndex + 1} / ${state.trackCount} · fragmento ${secs(state.stepMs)}` : ''}
        </span>
        <span className={`pill ${status === 'joined' ? 'on' : 'off'}`}>Sala {room}</span>
      </header>

      <main>
        {status !== 'joined' && status !== 'connecting' ? (
          <div className="huge muted">{status === 'no_room' ? 'Sala inexistente' : status === 'host_gone' ? 'Esperando al juez…' : status === 'offline' ? 'Reconectando…' : status === 'replaced' ? 'Esta pantalla se abrió en otro lado' : status === 'room_full' ? 'La sala está llena' : 'Sala cerrada'}</div>
        ) : !state || state.phase === 'lobby' ? (
          <div className="col" style={{ alignItems: 'center' }}>
            <div className="huge">Sumate con tu celu</div>
            <RoomQr url={joinUrl(room)} />
            <div className="code">{room}</div>
            <div className="muted">{location.host}</div>
            <div className="row" style={{ justifyContent: 'center' }}>
              {state?.players.map((p) => <span key={p.id} className="pill" style={{ borderColor: p.color, color: 'var(--text)' }}><span className="dot" style={{ background: p.color }} />{p.name}</span>)}
            </div>
          </div>
        ) : state.phase === 'finished' ? (
          <FinishedScreen state={state} />
        ) : state.phase === 'revealed' && state.revealed ? (
          <RevealCard revealed={state.revealed} solver={solver} />
        ) : floor ? (
          <div className="fade">
            <div className="muted big">tiene la palabra</div>
            <div className="huge" style={{ color: floor.color, fontSize: 'clamp(3rem, 12vw, 9rem)' }}>{floor.name}</div>
            {state.lastEvent?.reactionMs !== undefined && <div className="muted">{secs(state.lastEvent.reactionMs)} después de la primera nota</div>}
          </div>
        ) : state.phase === 'playing' ? (
          <div className="listen"><div className="cover">🎧</div><div className="huge">Escuchá…</div></div>
        ) : state.phase === 'open' ? (
          <div><div className="cover">❓</div><div className="huge">¿Quién la sabe?</div><div className="muted big">{state.notice ?? ''}</div></div>
        ) : (
          <div><div className="cover">🎵</div><div className="huge muted">Tema {state.trackIndex + 1}</div></div>
        )}
      </main>

      {state && state.phase !== 'lobby' && state.phase !== 'finished' && <Scoreboard state={state} compact />}
    </div>
  );
}

function FinishedScreen({ state }: { state: PublicState }) {
  // La TV no recalcula: muestra el ranking y los ganadores que calculó el juez.
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const final = state.final ?? fallbackFinal(state);
  const entries: StandingEntry[] = final.ranking.flatMap((r) => {
    const p = byId.get(r.id);
    return p ? [{ id: r.id, name: p.name, color: p.color, score: r.score, position: r.position, detail: `${r.correct} aciertos` }] : [];
  });
  return (
    <div className="col" style={{ alignItems: 'center' }}>
      <FinalStandings entries={entries} winnerIds={final.winnerIds} big />
      {state.awards && (
        <div className="awards mt" style={{ width: 'min(900px, 90vw)' }}>
          {state.awards.map((a) => <div key={a.k} className="award"><div className="k">{a.k}</div><div className="v">{a.v}</div><div className="muted small">{a.sub}</div></div>)}
        </div>
      )}
    </div>
  );
}

/** Juez con una versión anterior que no manda `final`: mismo criterio, sin aciertos. */
function fallbackFinal(state: PublicState): FinalResult {
  const ranking = rankStandings(state.players.map((p) => ({ id: p.id, score: p.score, correct: 0 })));
  return { ranking, winnerIds: ranking.filter((r) => r.position === 1).map((r) => r.id) };
}
