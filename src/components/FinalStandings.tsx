// Resultado final con un único criterio (rankStandings del motor): lo usan
// el juez, el historial, la TV y los celulares, así ninguna pantalla anuncia otro ganador.
import type { FinalResult, PublicState } from '../game/types';
import { rankStandings } from '../game/engine';

export interface StandingEntry {
  id: string;
  name: string;
  color: string;
  score: number;
  position: number;
  detail?: string;
}

/** "Ana", "Ana y Beto", "Ana, Beto y Cami". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

export function winnerLine(entries: StandingEntry[], winnerIds: string[]): string {
  const names = entries.filter((e) => winnerIds.includes(e.id)).map((e) => e.name);
  if (names.length === 0) return '';
  return names.length === 1 ? `🏆 Ganó ${names[0]}` : `🤝 Empate: ${joinNames(names)}`;
}

export function FinalStandings({ entries, winnerIds, big = false }: { entries: StandingEntry[]; winnerIds: string[]; big?: boolean }) {
  const top = entries.filter((e) => e.position <= 3).slice(0, 3);
  const rest = entries.slice(top.length);
  // Podio clásico (2º, 1º, 3º) sólo cuando no hay empates en el podio.
  const classic = top.length === 3 && new Set(top.map((e) => e.position)).size === 3;
  const order = classic ? [top[1], top[0], top[2]] : top;
  return (
    <div className="col" style={{ alignItems: 'center' }}>
      <div className={big ? 'huge' : 'big'} style={{ fontWeight: 800 }} data-testid="winner-line">{winnerLine(entries, winnerIds)}</div>
      <div className="podium">
        {order.map((e) => {
          const won = winnerIds.includes(e.id);
          return (
            <div key={e.id} className={`p ${won ? 'first' : ''}`} style={{ ['--c' as string]: e.color }} data-testid="podium-entry">
              <div>{won ? '🏆' : `${e.position}º`}</div>
              <div style={{ fontWeight: 800, fontSize: big ? '1.3rem' : undefined }}>{e.name}</div>
              <div className="s" style={{ color: e.score < 0 ? 'var(--bad)' : undefined }}>{e.score}</div>
              {e.detail && <div className="muted small">{e.detail}</div>}
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          {rest.map((e) => (
            <span key={e.id} className="pill" style={{ borderColor: e.color }}>{e.position}º {e.name} · {e.score}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Resultado final a partir del estado público (TV y celulares): no se
 * recalcula, se muestra el ranking que calculó el juez. Si el juez tiene una
 * versión anterior que no lo manda, mismo criterio con lo disponible.
 */
export function publicStandings(state: PublicState): { entries: StandingEntry[]; winnerIds: string[] } {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  const final: FinalResult = state.final ?? (() => {
    const ranking = rankStandings(state.players.map((p) => ({ id: p.id, score: p.score, correct: 0 })));
    return { ranking, winnerIds: ranking.filter((r) => r.position === 1).map((r) => r.id) };
  })();
  const entries = final.ranking.flatMap((r) => {
    const p = byId.get(r.id);
    return p ? [{ id: r.id, name: p.name, color: p.color, score: r.score, position: r.position, detail: `${r.correct} aciertos` }] : [];
  });
  return { entries, winnerIds: final.winnerIds };
}
