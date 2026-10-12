import { useEffect, useRef, useState } from 'react';
import type { HostCtx } from './Host';
import * as E from '../game/engine';
import { Scoreboard } from '../components/Scoreboard';
import { usePress } from '../components/press';
import { JoinRequests, RoomChanged } from '../components/JoinRequests';
import { ConnectPlayer, ManualPlayer, SdkPlayer, sdkSupported } from '../spotify/player';
import { loadPlayerMode, savePlayerMode, type PlayerModeSetting } from '../storage/store';
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
  const [peekNext, setPeekNext] = useState(false);
  const [mesa, setMesa] = useState(() => game.players.some((p) => !ctx.peers.has(p.id)));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const gameRef = useRef(game);
  gameRef.current = game;

  const guard = async (fn: () => Promise<void>) => {
    setErr(undefined); setBusy(true); busyRef.current = true;
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); busyRef.current = false; }
  };

  const play = () => {
    if (busyRef.current) return; // la tecla espacio no pasa por el botón deshabilitado
    return guard(async () => {
      if (!player) throw new Error('No hay reproductor configurado. Elegí uno en el panel "Reproductor" de la derecha.');
      if (!player.ready) await player.init();
      // Misma base temporal que las pulsaciones (B03). Mide desde la orden de
      // reproducir, no desde que el audio se oye.
      const at = ctx.now();
      update((g) => E.markPlaying(g, at));
      try {
        await player.playSnippet(track.uri, track.startMs, len);
      } finally {
        // Terminó, se canceló o falló: esta pasada deja de "sonar" y se puede
        // repetir. Si ya arrancó otra (o alguien tocó), no la tocamos.
        update((g) => (g.round.playStartedAt === at ? E.markSnippetEnded(g) : g));
      }
    });
  };

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
  const stopMusic = () => {
    void player?.stop();
    update(E.markSnippetEnded); // "sonando" → pulsadores abiertos; sin efecto en otras fases
  };

  // Teclas: 1-8 pulsadores (modo mesa), espacio = sonar, C/X/T = correcto/incorrecto/tarareo, N = siguiente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // Enter / Espacio sobre un botón enfocado activan ese botón, no un atajo.
      if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
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
    // Los pulsadores en pantalla van por el mismo camino que los del celu, en hora del servidor.
    ctx.buzz(pid, ctx.now());
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
          <span className={`pill ${player?.ready ? 'on' : 'off'}`}>{player?.ready ? MODE_LABEL[player.mode] : 'Sin reproductor'}</span>
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

          <RoomChanged ctx={ctx} />
          <JoinRequests ctx={ctx} />
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
                <Pad key={p.id} name={p.name} color={p.color} hotkey={p.key} disabled={!E.canBuzz(game, p.id)} onBuzz={() => localBuzz(p.id)} />
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
          <PlayerQuick ctx={ctx} />
          <div className="card soft" data-testid="upcoming">
            <div className="row between">
              <h3 style={{ margin: 0 }}>Próximos</h3>
              {mesa && game.round.trackIndex + 1 < game.tracks.length && (
                <button className="btn sm ghost" onPointerDown={() => setPeekNext(true)} onPointerUp={() => setPeekNext(false)} onPointerLeave={() => setPeekNext(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setPeekNext(true); }} onKeyUp={() => setPeekNext(false)} onBlur={() => setPeekNext(false)}>
                  Mantener para ver
                </button>
              )}
            </div>
            <ul className="list mt">
              {game.tracks.slice(game.round.trackIndex + 1, game.round.trackIndex + 4).map((t, i) => (
                <li key={t.uri} className="item">
                  <span className="muted small">{game.round.trackIndex + 2 + i}</span>
                  {/* En modo mesa la pantalla es compartida: los títulos futuros ni siquiera se dibujan. */}
                  {mesa && !peekNext
                    ? <div className="t"><b>Tema oculto</b><span>modo mesa</span></div>
                    : <div className="t"><b>{t.name}</b><span>{t.artists}</span></div>}
                </li>
              ))}
              {game.round.trackIndex + 1 >= game.tracks.length && <li className="muted small">Este es el último.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pulsador de modo mesa: toque, tecla numérica, o Enter/Espacio con el foco encima. */
function Pad({ name, color, hotkey, disabled, onBuzz }: { name: string; color: string; hotkey?: string; disabled: boolean; onBuzz: () => void }) {
  const press = usePress(onBuzz);
  return (
    <button className="pad" style={{ ['--c' as string]: color }} disabled={disabled} {...press}>
      {name}
      <kbd>tecla {hotkey}</kbd>
    </button>
  );
}

const MODE_LABEL: Record<PlayerModeSetting, string> = {
  sdk: 'Suena acá',
  connect: 'Spotify Connect',
  manual: 'Música manual'
};

/** Reproductor dentro del juego: activar, cambiar de modo o pasar a música manual sin volver al lobby. */
function PlayerQuick({ ctx }: { ctx: HostCtx }) {
  const { player } = ctx;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  // `mode` es la selección pendiente; el modo activo es siempre `player.mode`.
  // Al recargar, el reproductor real llega después del primer render: cuando
  // llega (o cambia), la selección se alinea con él.
  const [mode, setMode] = useState<PlayerModeSetting>(() => player?.mode ?? loadPlayerMode() ?? (sdkSupported() ? 'sdk' : 'connect'));
  useEffect(() => { if (player) setMode(player.mode); }, [player]);

  const activate = async () => {
    setErr(undefined); setBusy(true);
    try {
      let p = player;
      if (!p || p.mode !== mode) {
        if (mode === 'manual') p = new ManualPlayer();
        else if (mode === 'sdk') p = new SdkPlayer();
        else p = new ConnectPlayer();
        p.onStatus = ctx.setPlayerStatus;
        ctx.setPlayer(p);
        savePlayerMode(mode);
      }
      if (!p.ready) await p.init();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="card soft">
      <h3>Reproductor</h3>
      <div className="muted small mb" data-testid="player-active">
        Activo: <b>{player ? MODE_LABEL[player.mode] : 'ninguno'}</b> · {ctx.playerStatus}
      </div>
      <div className="row">
        <select aria-label="Reproductor" value={mode} onChange={(e) => setMode(e.target.value as PlayerModeSetting)} className="grow">
          {sdkSupported() && <option value="sdk">Suena en este navegador</option>}
          <option value="connect">App de Spotify (Connect)</option>
          <option value="manual">Música manual (sin Spotify)</option>
        </select>
        <button className="btn sm primary" disabled={busy || (mode !== 'manual' && !ctx.loggedIn)} onClick={activate}>{busy ? '…' : player?.ready ? 'Reactivar' : 'Activar'}</button>
      </div>
      {mode !== 'manual' && !ctx.loggedIn && <div className="error small mt">Sin sesión de Spotify. Terminá la partida y conectala en el lobby, o usá música manual.</div>}
      {err && <div className="error small mt">{err}</div>}
    </div>
  );
}
