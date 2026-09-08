import type { PublicState } from '../game/types';

export function Scoreboard({ state, compact = false }: { state: Pick<PublicState, 'players' | 'lockedPlayerIds' | 'buzzedPlayerId'>; compact?: boolean }) {
  return (
    <div className="scoreboard">
      {state.players.map((p) => (
        <div
          key={p.id}
          className={`score ${state.lockedPlayerIds.includes(p.id) ? 'locked' : ''} ${state.buzzedPlayerId === p.id ? 'floor' : ''}`}
          style={{ ['--c' as string]: p.color }}
        >
          {!p.connected && !compact && <span className="off">sin conexión</span>}
          <span className="n">{p.name}</span>
          <span className={`s ${p.score < 0 ? 'neg' : ''}`}>{p.score}</span>
        </div>
      ))}
    </div>
  );
}
