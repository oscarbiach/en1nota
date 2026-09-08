import { useState } from 'react';
import { deleteHistory, loadHistory, type HistoryEntry } from '../storage/store';
import { Podium } from '../components/Podium';
import { fecha, secs } from '../util/format';
import { navigate } from '../App';

export function HistoryView() {
  const [items, setItems] = useState<HistoryEntry[]>(loadHistory);
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);
  const sel = items.find((h) => h.id === open);

  // Récords acumulados entre partidas.
  const totals = new Map<string, { games: number; wins: number; points: number }>();
  for (const h of items) {
    const top = [...h.players].sort((a, b) => b.score - a.score)[0];
    for (const p of h.players) {
      const t = totals.get(p.name) ?? { games: 0, wins: 0, points: 0 };
      t.games++; t.points += p.score; if (top && top.name === p.name && top.score > 0) t.wins++;
      totals.set(p.name, t);
    }
  }
  const table = [...totals.entries()].sort((a, b) => b[1].wins - a[1].wins || b[1].points - a[1].points);

  return (
    <div className="page">
      <div className="row between mb">
        <div className="row"><button className="btn sm ghost" onClick={() => navigate('/')}>← Inicio</button><h1 style={{ margin: 0 }}>Historial</h1></div>
        <button className="btn sm" onClick={() => navigate('/juez')}>Panel del juez</button>
      </div>
      {items.length === 0 && <p className="muted">Todavía no hay partidas terminadas en este dispositivo.</p>}

      {table.length > 0 && (
        <div className="card mb">
          <h2>Ranking histórico</h2>
          <table>
            <thead><tr><th>Jugador</th><th className="num">Partidas</th><th className="num">Ganadas</th><th className="num">Puntos</th></tr></thead>
            <tbody>
              {table.map(([name, t]) => <tr key={name}><td>{name}</td><td className="num">{t.games}</td><td className="num">{t.wins}</td><td className="num">{t.points}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid2">
        <ul className="list">
          {items.map((h) => (
            <li key={h.id} className={`item ${h.id === open ? 'current' : ''}`} onClick={() => setOpen(h.id)} style={{ cursor: 'pointer' }}>
              <div className="t">
                <b>{fecha(h.playedAt)}</b>
                <span>{h.trackCount} temas · {[...h.players].sort((a, b) => b.score - a.score).map((p) => `${p.name} ${p.score}`).join(' · ')}</span>
              </div>
              <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); if (confirm('¿Borrar esta partida?')) { deleteHistory(h.id); setItems(loadHistory()); } }}>✕</button>
            </li>
          ))}
        </ul>
        {sel && (
          <div className="card">
            <h2>{fecha(sel.playedAt)}</h2>
            <Podium game={sel.game} />
            <h3 className="mt">Tema por tema</h3>
            <ul className="list">
              {sel.game.history.map((r) => {
                const t = sel.game.tracks[r.trackIndex];
                const solver = r.solvedBy ? sel.game.players.find((p) => p.id === r.solvedBy) : undefined;
                const buzz = solver ? [...r.events].reverse().find((e) => e.kind === 'buzz' && e.playerId === solver.id) : undefined;
                return (
                  <li key={r.trackIndex} className="item">
                    {t?.image && <img src={t.image} alt="" />}
                    <div className="t">
                      <b>{t?.name ?? '?'}</b>
                      <span>{solver ? `${solver.name} en la pasada ${r.step + 1}${buzz?.reactionMs !== undefined ? ` (${secs(buzz.reactionMs)})` : ''}` : 'nadie la sacó'}{r.events.filter((e) => e.kind === 'wrong' || e.kind === 'hum' || e.kind === 'timeout').length ? ` · ${r.events.filter((e) => e.kind === 'wrong' || e.kind === 'hum' || e.kind === 'timeout').length} fallos` : ''}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
