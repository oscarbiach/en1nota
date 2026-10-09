import type { GameState } from '../game/types';
import { computeStats } from '../game/engine';
import { secs } from '../util/format';
import { FinalStandings } from './FinalStandings';

export function Podium({ game, showAwards = true }: { game: GameState; showAwards?: boolean }) {
  const st = computeStats(game);
  const entries = st.ranking.map((p) => ({
    id: p.id, name: p.name, color: p.color, score: p.score, position: p.position,
    detail: `${p.correct} aciertos · ${p.wrong + p.hums} fallos`
  }));
  return (
    <div className="col">
      <FinalStandings entries={entries} winnerIds={st.winnerIds} />
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
