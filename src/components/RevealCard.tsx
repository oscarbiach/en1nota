import type { PublicState } from '../game/types';

export function RevealCard({ revealed, solver }: { revealed: NonNullable<PublicState['revealed']>; solver?: string }) {
  return (
    <div className="revealcard fade">
      {revealed.image ? <img src={revealed.image} alt="" /> : <div className="cover">🎵</div>}
      <div>
        <div className="big" style={{ fontWeight: 800 }}>{revealed.name}</div>
        <div className="muted">{revealed.artists}</div>
        {solver && <div className="mt" style={{ color: 'var(--ok)', fontWeight: 700 }}>La sacó {solver}</div>}
      </div>
    </div>
  );
}
