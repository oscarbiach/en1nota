import { useEffect, useRef, useState } from 'react';
import type { HostCtx } from './Host';
import * as E from '../game/engine';
import { Scoreboard } from '../components/Scoreboard';
import { secs, mmss } from '../util/format';
import { navigate } from '../App';

export function HostPlay({ ctx }: { ctx: HostCtx }) {
  const { game, update, player, room, online } = ctx;
  const track = E.currentTrack(game)!;
  const step = game.round.step;
  const len = E.stepMs(game.settings, step);
  const floor = game.round.buzzedPlayerId ? game.players.find((p) => p.id === game.round.buzzedPlayerId) : undefined;
  const [err, setErr] = useState<string>();
  const [peek, setPeek] = useState(false);
  const [mesa, setMesa] = useState(() => game.players.some((p) => !ctx.peers.has(p.id)));
  const [busy, setBusy] = useState(false);
  const gameRef = useRef(game);
  gameRef.current = game;

  const guard = async (fn: () => Promise<void>) => {
    setErr(undefined); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const play = () => guard(async () => {
    if (!player?.ready) throw new Error('El reproductor no está activo. Volvé a la pestaña Spotify del lobby.');
    update((g) => E.markPlaying(g));
    const idx = game.round.trackIndex;
    await player.playSnippet(track.uri, track.startMs, len);
    update((g) => (g.round.trackIndex === idx ? E.markSnippetEnded(g) : g));
  });

  const correct = () => {
    ctx.sfx('correct', floor?.id);
    update((g) => E.judgeCorrect(g));
    void guard(async () => { setTimeout(() => { ctx.sfx('reveal'); }, 0); await player?.play(track.uri, track.startMs, game.settings.revealMs); });
  };
  const wrong = () => { ctx.sfx('wrong', floor?.id); update((g) => E.judgeWrong(g)); };
  const hum = () => { ctx.sfx('hum', floor?.id); update((g) => E.judgeHum(g)); };
  const blank = () => { ctx.sfx('wrong', floor?.id); update((g) => E.judgeTimeout(g)); };
  const longer = () => update((g) => E.nextStep(g));
  const revealNow = () => {
    ctx.sfx('reveal');
    update((g) => E.reveal(g));
    void guard(async () => { await player?.play(track.uri, track.startMs, game.settings.revealMs); });
  };
  const next = () => {
    void player?.stop();
    update((g) => E.nextTrack(g));
    if (game.round.trackIndex + 1 >= game.tracks.length) ctx.sfx('finish');
  };
  const skip = () => { if (confirm('¿Saltar este tema sin puntos?')) { void player?.stop(); update((g) => E.skipTrack(g)); } };
  const stopMusic = () => void player?.stop();

  // Teclas: 1-8 pulsadores (modo mesa), espacio = sonar, C/X/T = correcto/incorrecto/tarareo, N = siguiente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const g = gameRef.current;
      if (/^[1-8]$/.test(e.key)) {
        const p = g.players.find((x) => x.key === e.key && !ctx.peers.has(x.id));
        if (p) localBuzz(p.id);
        return;
      }
      if (e.key === ' ' && ['ready', 'open'].includes(g.phase)) { e.preventDefault(); void play(); }
      if (g.phase === 'buzzed') {
        if (e.key === 'c' || e.key === 'C') correct();
        if (e.key === 'x' || e.key === 'X') wrong();
        if (e.key === 't' || e.key === 'T') hum();
      }
      if ((e.key === 'n' || e.key === 'N') && g.phase === 'revealed') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.uri, len, player, floor?.id]);

  const localBuzz = (pid: string) => {
    // Los pulsadores en pantalla van por el mismo camino que los del celu, con reloj del host.
    const at = ctx.conn.socket.online ? ctx.conn.socket.serverNow() : Date.now();
    ctx.buzz(pid, at);
  };

  const phaseLabel: Record<string, string> = {
    ready: 'Listo para sonar', playing: 'Sonando…', open: 'Pulsadores abiertos', buzzed: 'Alguien tiene la palabra', revealed: 'Revelada'
  };

  return (
    <div className="page wide">
      <div className="row between mb">
        <div className="row">
          <button className="btn sm ghost" onClick={() => navigate('/')}>← Inicio</button>
          <b>Tema {game.round.trackIndex + 1} / {game.tracks.length}</b>
        </div>
        <div className="row">
          <span className={`pill ${online ? 'on' : 'off'}`}>{room ? `Sala ${room}` : 'sin sala'}</span>
          <span className={`pill ${player?.ready ? 'on' : 'off'}`}>{player?.ready ? ('manual' in player ? 'Música manual' : player.mode === 'sdk' ? 'Suena acá' : 'Spotify Connect') : 'Sin reproductor'}</span>
          <label className="row small" style={{ margin: 0 }}><input type="checkbox" checked={mesa} onChange={(e) => setMesa(e.target.checked)} />Modo mesa</label>
        </div>
      </div>

      <div className="judge">
        <div className="stage">
          <div className="row between">
            <span className="phase">{phaseLabel[game.phase] ?? game.phase}</span>
            <div className="steps">
              {game.settings.steps.map((s, i) => <span key={i} className={i === step ? 'on' : i < step ? 'past' : ''}>{secs(s)}</span>)}
            </div>
          </div>

          <div
            className={`secret ${mesa && !peek && game.phase !== 'revealed' ? 'hidden' : ''}`}
            onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)}
            title={mesa ? 'Mantené apretado para espiar' : ''}
          >
            <div className="row">
              {track.image && <img src={track.image} alt="" style={{ width: 56, height: 56, borderRadius: 8, filter: mesa && !peek && game.phase !== 'revealed' ? 'blur(8px)' : 'none' }} />}
              <div className="grow" style={{ minWidth: 0 }}>
                <b style={{ display: 'block' }}>{track.name}</b>
                <span className="muted small">{track.artists} · desde {mmss(track.startMs)}</span>
              </div>
            </div>
            {mesa && game.phase !== 'revealed' && <div className="muted small mt">Mantené apretado para ver el título (modo mesa lo oculta).</div>}
          </div>

          {game.notice && <div className="notice fade">{game.notice}</div>}
          {err && <div className="error small">{err}</div>}

          {floor ? (
            <div className="fade" style={{ ['--c' as string]: floor.color }}>
              <div className="muted">Tiene la palabra</div>
              <div className="floorname">{floor.name}</div>
              {game.round.events.at(-1)?.reactionMs !== undefined && <div className="muted small">reaccionó a los {secs(game.round.events.at(-1)!.reactionMs!)}</div>}
              <div className="actions mt">
                <button className="btn ok xl" onClick={correct}>✔ Correcto <small>(C)</small></button>
                <button className="btn bad xl" onClick={wrong}>✘ Incorrecto <small>(X)</small></button>
                <button className="btn warn xl" onClick={hum}>🎤 Tarareó <small>(T)</small></button>
                <button className="btn xl" onClick={blank}>😶 En blanco</button>
              </div>
            </div>
          ) : game.phase === 'revealed' ? (
            <div className="actions">
              <button className="btn primary xl" onClick={next}>{game.round.trackIndex + 1 >= game.tracks.length ? 'Terminar partida' : 'Siguiente tema (N)'}</button>
              <button className="btn" onClick={stopMusic}>■ Parar música</button>
              <button className="btn" disabled={busy} onClick={() => guard(async () => { await player?.play(track.uri, track.startMs, game.settings.revealMs); })}>▶ Sonar de nuevo</button>
            </div>
          ) : (
            <div className="actions">
              <button className="btn primary xl" disabled={busy || game.phase === 'playing'} onClick={play}>
                ▶ Sonar {secs(len)} <small>(espacio)</small>
              </button>
              {E.hasMoreSteps(game) && game.phase === 'open' && <button className="btn info xl" onClick={longer}>Más largo → {secs(E.stepMs(game.settings, step + 1))}</button>}
              <button className="btn xl" onClick={revealNow}>Revelar (nadie)</button>
              <button className="btn ghost" onClick={stopMusic}>■ Parar</button>
            </div>
          )}

          {mesa && (
            <div className="pads mt">
              {game.players.filter((p) => !ctx.peers.has(p.id)).map((p) => (
                <button key={p.id} className="pad" style={{ ['--c' as string]: p.color }} disabled={!E.canBuzz(game, p.id)} onPointerDown={() => localBuzz(p.id)}>
                  {p.name}
                  <kbd>tecla {p.key}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="col">
          <Scoreboard state={E.toPublic(game)} />
          <div className="card soft">
            <h3>Ajustes rápidos</h3>
            <ul className="list">
              {game.players.map((p) => (
                <li key={p.id} className="item">
                  <span className="dot" style={{ background: p.color }} />
                  <div className="t"><b>{p.name}</b><span>{game.round.lockedPlayerIds.includes(p.id) ? 'bloqueado en este tema' : p.connected || !ctx.peers.has(p.id) ? '' : 'sin conexión'}</span></div>
                  <button className="btn sm" onClick={() => update((g) => E.adjustScore(g, p.id, -1))}>−1</button>
                  <b style={{ width: 36, textAlign: 'center' }}>{p.score}</b>
                  <button className="btn sm" onClick={() => update((g) => E.adjustScore(g, p.id, 1))}>+1</button>
                </li>
              ))}
            </ul>
            <div className="row mt">
              <button className="btn sm" onClick={skip}>Saltar tema</button>
              <button className="btn sm ghost" onClick={() => { if (confirm('¿Terminar la partida ahora?')) { void player?.stop(); ctx.sfx('finish'); update(E.finishGame); } }}>Terminar partida</button>
            </div>
          </div>
          <div className="card soft">
            <h3>Próximos</h3>
            <ul className="list">
              {game.tracks.slice(game.round.trackIndex + 1, game.round.trackIndex + 4).map((t, i) => (
                <li key={t.uri} className="item"><span className="muted small">{game.round.trackIndex + 2 + i}</span><div className="t"><b>{t.name}</b><span>{t.artists}</span></div></li>
              ))}
              {game.round.trackIndex + 1 >= game.tracks.length && <li className="muted small">Este es el último.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
