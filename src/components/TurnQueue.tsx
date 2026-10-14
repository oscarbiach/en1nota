import type { PublicState } from '../game/types';

export function TurnQueue({ state }: { state: PublicState }) {
  const queue = (state.queuedPlayerIds ?? []).map((id) => state.players.find((p) => p.id === id)).filter((p) => !!p);
  if (!queue.length) return null;
  return <div className="turn-queue" aria-live="polite" aria-label="Orden de turnos">
    <span className="eyebrow">Si falla, sigue</span>
    <ol>{queue.map((p, i) => <li key={p.id} style={{ ['--c' as string]: p.color }}><span>{i + 1}</span>{p.name}</li>)}</ol>
  </div>;
}
