import type { HostCtx } from '../views/Host';
import { isRemotePlayer } from '../game/engine';

/**
 * Celulares que entraron con la partida empezada (B09): tras un reinicio del
 * servidor, o si un celular perdió su sesión. El juez, que los tiene
 * enfrente, confirma quién es cada uno. Nunca se asigna un puesto solo.
 */
export function JoinRequests({ ctx }: { ctx: HostCtx }) {
  const { joinRequests, game } = ctx;
  if (joinRequests.length === 0) return null;
  // Primero los que están sin conexión y con el mismo nombre: los candidatos más probables.
  const candidates = (name: string) =>
    [...game.players].sort((a, b) =>
      Number(a.connected) - Number(b.connected) ||
      Number(b.name.toLowerCase() === name.toLowerCase()) - Number(a.name.toLowerCase() === name.toLowerCase()) ||
      Number(isRemotePlayer(b)) - Number(isRemotePlayer(a)));
  return (
    <div className="col" role="region" aria-label="Celulares que piden entrar">
      {joinRequests.map((r) => (
        <div key={r.pid} className="notice" data-testid="join-request">
          <div style={{ fontWeight: 700 }}>📱 «{r.name || 'Sin nombre'}» quiere entrar</div>
          <div className="muted small mb">¿Quién es? Si ya estaba jugando, conserva su puntaje.</div>
          <div className="row">
            {candidates(r.name).map((p) => (
              <button key={p.id} className="btn sm" onClick={() => ctx.resolveJoin(r.pid, p.id)} style={{ borderColor: p.color }}>
                Es {p.name} ({p.score}){p.connected ? ' · conectado' : ''}
              </button>
            ))}
            <button className="btn sm" disabled={game.players.length >= 8} onClick={() => ctx.resolveJoin(r.pid, 'new')}>Jugador nuevo</button>
            <button className="btn sm ghost" onClick={() => ctx.resolveJoin(r.pid, 'reject')}>Rechazar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** El servidor se reinició sin poder recuperar la sala: los celulares necesitan el código nuevo. */
export function RoomChanged({ ctx }: { ctx: HostCtx }) {
  if (!ctx.roomChangedFrom || !ctx.room) return null;
  return (
    <div className="error" role="alert" data-testid="room-changed">
      <div style={{ fontWeight: 700 }}>El servidor se reinició y la sala cambió: ahora es <span className="code" style={{ fontSize: '1.4rem' }}>{ctx.room}</span></div>
      <div className="small mt">
        Los celulares que estaban en {ctx.roomChangedFrom} tienen que entrar con el código nuevo. Cuando entren, vas a confirmar quién es cada uno y conservan su puntaje.
      </div>
      <button className="btn sm mt" onClick={ctx.dismissRoomChanged}>Entendido</button>
    </div>
  );
}
