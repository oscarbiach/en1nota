import type { GameState } from '../game/types';
import { computeStats } from '../game/engine';
import { secs } from '../util/format';

export function Podium({ game, showAwards = true }: { game: GameState; showAwards?: boolean }) {
  const st = computeStats(game);
  const top = st.ranking.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  return (
    <div className="col">
      <div className="podium">
        {order.map((p) => (
          <div key={p.id} className={`p ${p.id === top[0]?.id ? 'first' : ''}`} style={{ ['--c' as string]: p.color }}>
            <div>{p.id === top[0]?.id ? '🏆' : '🎖️'}</div>
            <div style={{ fontWeight: 800 }}>{p.name}</div>
            <div className="s" style={{ color: p.score < 0 ? 'var(--bad)' : undefined }}>{p.score}</div>
            <div className="muted small">{p.correct} aciertos · {p.wrong + p.hums} fallos</div>
          </div>
        ))}
      </div>
      {st.ranking.length > 3 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          {st.ranking.slice(3).map((p, i) => (
            <span key={p.id} className="pill" style={{ borderColor: p.color }}>{i + 4}º {p.name} · {p.score}</span>
          ))}
        </div>
      )}
      {showAwards && (
        <div className="awards mt">
          {st.fastest && <div className="award"><div className="k">⚡ Reflejo</div><div className="v">{st.fastest.player.name}</div><div className="muted small">acertó a los {secs(st.fastest.reactionMs)}</div></div>}
          {st.mostImpulsive && <div className="award"><div className="k">🤦 Impulsivo</div><div className="v">{st.mostImpulsive.name}</div><div className="muted small">{st.mostImpulsive.wrong + st.mostImpulsive.hums} fallos</div></div>}
          {st.mostHums && <div className="award"><div className="k">🎤 Tarareador</div><div className="v">{st.mostHums.name}</div><div className="muted small">{st.mostHums.hums} tarareos</div></div>}
          {st.mostNegative && <div className="award"><div className="k">📉 Bajo cero</div><div className="v">{st.mostNegative.name}</div><div className="muted small">terminó con {st.mostNegative.score}</div></div>}
          <div className="award"><div className="k">🙈 Nadie la sacó</div><div className="v">{st.unsolved}</div><div className="muted small">de {game.history.length} temas</div></div>
        </div>
      )}
    </div>
  );
}
