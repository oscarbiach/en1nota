import { useEffect, useRef, useState } from 'react';
import type { HostCtx } from './hostCtx';
import * as E from '../game/engine';
import { Scoreboard } from '../components/Scoreboard';
import { TurnQueue } from '../components/TurnQueue';
import { SoundWave } from '../components/SoundWave';
import { usePress } from '../components/press';
import { JoinRequests, RoomChanged } from '../components/JoinRequests';
import { ConnectPlayer, ManualPlayer, PreviewPlayer, SdkPlayer, defaultPlayerMode, isIOS, sdkSupported } from '../spotify/player';
import { loadConnectDevice, loadPlayerMode, loadPreferredDevice, saveConnectDevice, savePlayerMode, type PlayerModeSetting } from '../storage/store';
import { phoneDevices, type Device } from '../spotify/api';
import { secs, mmss } from '../util/format';
import { navigate } from '../router';

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
  const selfJudge = game.mode === 'solo' || game.mode === 'duel';
  const showAnswer = game.phase === 'revealed' || (selfJudge ? game.round.answerShown : !mesa || peek);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const gameRef = useRef(game);
  gameRef.current = game;

  // Al cambiar o reactivar el reproductor, lo que esperaba al anterior ya no
  // importa: el panel queda libre para sonar con el nuevo.
  // Si el fragmento quedó "sonando" con el reproductor anterior, se da por terminado.
  const firstPlayer = useRef(true);
  useEffect(() => {
    if (firstPlayer.current) { firstPlayer.current = false; return; }
    busyRef.current = false; setBusy(false);
    update(E.markSnippetEnded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const guard = async (fn: () => Promise<void>) => {
    setErr(undefined); setBusy(true); busyRef.current = true;
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); busyRef.current = false; }
  };

  /**
   * iPhone: si Spotify no deja sonar la canción completa en el navegador, el
   * juego no queda mudo: pasa solo a Vista previa (para esta sesión; la
   * próxima vez vuelve a intentar la canción completa).
   */
  const fallBackToPreview = (e: unknown): never => {
    if (player?.mode === 'sdk' && isIOS()) {
      const v = new PreviewPlayer();
      v.onStatus = ctx.setPlayerStatus;
      ctx.setPlayer(v);
      throw new Error(`En este iPhone Spotify no dejó sonar la canción completa (${(e as Error).message}). Pasé a «Vista previa» (30 s de muestra): tocá Sonar de nuevo.`);
    }
    throw e;
  };

  const play = () => {
    if (busyRef.current || gameRef.current.round.pending.length) return; // la tecla espacio no pasa por el botón deshabilitado
    return guard(async () => {
      if (!player) throw new Error('No hay reproductor configurado. Elegí uno en el panel "Reproductor" de la derecha.');
      if (!player.ready) await player.init().catch(fallBackToPreview);
      // Misma base temporal que las pulsaciones (B03). Mide desde la orden de
      // reproducir, no desde que el audio se oye.
      const at = ctx.now();
      update((g) => E.markPlaying(g, at));
      try {
        await player.playSnippet(track.uri, track.startMs, len).catch(fallBackToPreview);
      } finally {
        // Terminó, se canceló o falló: esta pasada deja de "sonar" y se puede
        // repetir. Si ya arrancó otra (o alguien tocó), no la tocamos.
        update((g) => (g.round.playStartedAt === at ? E.markSnippetEnded(g) : g));
      }
    });
  };

  const correct = () => {
    if (selfJudge && !gameRef.current.round.answerShown) return;
    ctx.sfx('correct', floor?.id);
    update((g) => E.judgeCorrect(g));
    void guard(async () => { setTimeout(() => { ctx.sfx('reveal'); }, 0); await player?.play(track.uri, track.startMs, game.settings.revealMs); });
  };
  // Si el juez estaba escuchando para verificar, se corta antes de seguir: los demás no deben oír más.
  const wrong = () => { void player?.stop(); ctx.sfx('wrong', floor?.id); update((g) => E.judgeWrong(g)); };
  const blank = () => { void player?.stop(); ctx.sfx('wrong', floor?.id); update((g) => E.judgeTimeout(g)); };
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

  // Teclas: 1-8 pulsadores (modo mesa), espacio = sonar, C/X = correcto/incorrecto, N = siguiente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // Enter / Espacio sobre un botón enfocado activan ese botón, no un atajo.
      if ((tag === 'BUTTON' || tag === 'SUMMARY') && (e.key === ' ' || e.key === 'Enter')) return;
      const g = gameRef.current;
      if (/^[1-8]$/.test(e.key)) {
        const p = g.players.find((x) => x.key === e.key && !ctx.peers.has(x.id));
        if (p) localBuzz(p.id);
        return;
      }
      if (e.key === ' ' && ['ready', 'open'].includes(g.phase)) { e.preventDefault(); void play(); }
      if (g.phase === 'buzzed') {
        if (e.key === 'c' || e.key === 'C') correct();
        if ((e.key === 'x' || e.key === 'X') && (!selfJudge || g.round.answerShown)) wrong();
      }
      if ((e.key === 'n' || e.key === 'N') && g.phase === 'revealed') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.uri, len, player, floor?.id, selfJudge]);

  const localBuzz = (pid: string) => {
    // Los pulsadores en pantalla van por el mismo camino que los del celu, en hora del servidor.
    ctx.buzz(pid, ctx.now());
  };

  const phaseLabel: Record<string, string> = {
    ready: 'Listo para sonar', playing: 'Sonando…', open: 'Pulsadores abiertos', buzzed: 'Alguien tiene la palabra', revealed: 'Revelada'
  };

  return (
    <div className="page wide play-page">
      <div className="row between mb">
        <div className="row">
          <button className="btn sm ghost" onClick={() => navigate('/')}>← Inicio</button>
          <b>Tema {game.round.trackIndex + 1} / {game.tracks.length}</b>
          <span className="eyebrow">{game.mode === 'solo' ? 'Solitario' : game.mode === 'duel' ? '1 contra 1' : 'La juntada'}</span>
        </div>
        <div className="row">
          <span className={`pill ${online ? 'on' : 'off'}`}>{room ? `Sala ${room}` : 'sin sala'}</span>
          <span className={`pill ${player?.ready ? 'on' : 'off'}`}>{player?.ready ? (player.deviceName ? `Suena en: ${player.deviceName}` : MODE_LABEL[player.mode]) : 'Sin reproductor'}</span>
          {!selfJudge && <label className="row small" style={{ margin: 0 }}><input type="checkbox" checked={mesa} onChange={(e) => setMesa(e.target.checked)} />Modo mesa</label>}
        </div>
      </div>

      <div className="judge">
        <div className={`stage phase-${game.phase}`}>
          <div className="row between">
            <span className="phase">{phaseLabel[game.phase] ?? game.phase}</span>
            <div className="steps">
              {game.settings.steps.map((s, i) => <span key={i} className={i === step ? 'on' : i < step ? 'past' : ''}>{secs(s)}</span>)}
            </div>
          </div>

          <div className={`secret ${showAnswer ? 'answer-visible' : 'mystery'}`}>
            {showAnswer ? <div className="row">
              {track.image && <img src={track.image} alt="" style={{ width: 72, height: 72, borderRadius: 16 }} />}
              <div className="grow" style={{ minWidth: 0 }}>
                <b style={{ display: 'block' }}>{track.name}</b>
                <span className="muted small">{track.artists} · desde {mmss(track.startMs)}</span>
              </div>
            </div> : <><SoundWave active={game.phase === 'playing'} /><span className="eyebrow">Tema {game.round.trackIndex + 1}</span><h2>{game.phase === 'playing' ? 'Dejá que tu oído haga lo suyo.' : 'Una nota. ¿Ya la tenés?'}</h2><p className="muted small">Escuchá el fragmento y respondé.</p></>}
            {!selfJudge && mesa && game.phase !== 'revealed' && <button className="btn sm ghost mt"
              onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} onPointerCancel={() => setPeek(false)}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPeek(true); } }} onKeyUp={() => setPeek(false)} onBlur={() => setPeek(false)}>
              Mantener para ver el título
            </button>}
          </div>

          <RoomChanged ctx={ctx} />
          <JoinRequests ctx={ctx} />
          {game.notice && <div className="notice fade">{game.notice}</div>}
          {err && <div className="error small">{err}</div>}

          {floor ? (
            <div key={floor.id} className="floor-card fade" style={{ ['--c' as string]: floor.color }}>
              <div className="muted">Tiene la palabra</div>
              <div className="floorname">{floor.name}</div>
              {game.round.events.at(-1)?.reactionMs !== undefined && <div className="muted small">reaccionó a los {secs(game.round.events.at(-1)!.reactionMs!)}</div>}
              {selfJudge && !game.round.answerShown ? <div className="mt">
                <p className="muted small">{game.mode === 'duel' ? 'Digan sus respuestas en voz alta. Quien quiera otro turno debe tocar antes de comprobar: después se cierra la cola.' : 'Decí o cantá tu respuesta antes de mirar. Después marcás cómo te fue.'}</p>
                <button className="btn primary xl" onClick={() => { void player?.stop(); update(E.checkAnswer); }}>Comprobar respuesta</button>
              </div> : <div className="actions mt">
                <button className="btn ok xl" onClick={correct}>✔ Correcto <small>(C)</small></button>
                <button className="btn bad xl" onClick={wrong}>✘ Incorrecto <small>(X)</small></button>
                <button className="btn xl" onClick={blank}>😶 En blanco</button>
              </div>}
              {!selfJudge && <details className="utility mt" open><summary>Escuchar para comprobar</summary><VerifyPlayer key={`${track.uri}-${game.round.step}-${floor.id}`} ctx={ctx} uri={track.uri} startMs={track.startMs} durationMs={track.durationMs} /></details>}
            </div>
          ) : game.phase === 'revealed' ? (
            <div className="actions">
              <button className="btn primary xl" onClick={next}>{game.round.trackIndex + 1 >= game.tracks.length ? 'Terminar partida' : 'Siguiente tema (N)'}</button>
              <button className="btn" onClick={stopMusic}>■ Parar música</button>
              <button className="btn" disabled={busy} onClick={() => guard(async () => { await player?.play(track.uri, track.startMs, game.settings.revealMs); })}>▶ Sonar de nuevo</button>
            </div>
          ) : (
            <div className="actions">
              <button className="btn primary xl" disabled={busy || game.phase === 'playing' || game.round.pending.length > 0} onClick={play}>
                ▶ Sonar {secs(len)} <small>(espacio)</small>
              </button>
              {E.hasMoreSteps(game) && game.phase === 'open' && <button className="btn info xl" disabled={game.round.pending.length > 0} onClick={longer}>Más largo → {secs(E.stepMs(game.settings, step + 1))}</button>}
              <button className="btn xl" onClick={revealNow}>Revelar (nadie)</button>
              <button className="btn ghost" onClick={stopMusic}>■ Parar</button>
            </div>
          )}

          <TurnQueue state={E.toPublic(game)} />
          {E.isSoloWritten(game) && game.phase !== 'revealed' && <SoloAnswer key={game.round.trackIndex} ctx={ctx} />}
          {!E.isSoloWritten(game) && (mesa || selfJudge) && (
            <div className="pads mt">
              {game.players.filter((p) => !ctx.peers.has(p.id)).map((p) => (
                <Pad key={p.id} name={p.name} color={p.color} hotkey={p.key} disabled={!E.canBuzz(game, p.id)} onBuzz={() => localBuzz(p.id)} />
              ))}
            </div>
          )}
        </div>

        <div className="col">
          <Scoreboard state={E.toPublic(game)} />
          <details className="card soft utility" open>
            <summary>Ajustes rápidos</summary>
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
          </details>
          <details className="utility" open><summary>Reproductor y conexión</summary><PlayerQuick ctx={ctx} /></details>
          {!selfJudge && <details className="card soft utility" data-testid="upcoming" open>
            <summary>Próximos temas</summary>
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
          </details>}
        </div>
      </div>
    </div>
  );
}

function SoloAnswer({ ctx }: { ctx: HostCtx }) {
  const [answer, setAnswer] = useState('');
  const [remaining, setRemaining] = useState(30);
  const current = useRef(ctx);
  current.current = ctx;
  const deadline = ctx.game.round.answerDeadline;
  const enabled = deadline !== undefined && ['playing', 'open'].includes(ctx.game.phase);
  const submit = (text: string) => {
    const c = current.current;
    const at = c.now();
    const next = E.submitSoloAnswer(c.game, text, at);
    if (next === c.game) return;
    void c.player?.stop();
    c.sfx(next.round.solvedBy ? 'correct' : 'wrong', c.game.players[0]?.id);
    c.update((g) => E.submitSoloAnswer(g, text, at));
  };
  useEffect(() => {
    if (!enabled || deadline === undefined) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - current.current.now()) / 1000));
      setRemaining(left);
      if (!left) submit('');
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [deadline, enabled]);
  return <form className="solo-answer" onSubmit={(e) => { e.preventDefault(); submit(answer); }}>
    <div className="row between"><label htmlFor="song-answer">¿Cómo se llama la canción?</label><span className={`countdown ${remaining <= 10 ? 'urgent' : ''}`} role="timer" aria-label={`${remaining} segundos restantes`}>{remaining}<small>s</small></span></div>
    <div className="time-track" aria-hidden="true"><span style={{ width: `${remaining / 30 * 100}%` }} /></div>
    <div className="row mt"><input id="song-answer" autoComplete="off" spellCheck={false} maxLength={200} placeholder="Escribí el título…" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!enabled} className="grow" /><button className="btn primary" disabled={!enabled || !answer.trim()}>Responder</button></div>
    <p className="small muted mt">{enabled ? 'Un intento. Tildes, signos y mayúsculas no importan.' : 'Tocá Sonar para empezar. Tenés 30 segundos.'}</p>
  </form>;
}

/**
 * Mientras alguien tiene la palabra, el juez puede escuchar la canción desde
 * donde quiera para comprobar si lo que cantaron es esa canción. No cambia la
 * partida: al marcar Correcto suena la revelación; al marcar Incorrecto o En
 * blanco, se corta.
 */
function VerifyPlayer({ ctx, uri, startMs, durationMs }: { ctx: HostCtx; uri: string; startMs: number; durationMs: number }) {
  const { player } = ctx;
  const [pos, setPos] = useState(startMs);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string>();
  const max = Math.max(durationMs - 1000, startMs);
  const clamp = (ms: number) => Math.max(0, Math.min(max, ms));

  if (!player || player.mode === 'manual') {
    return <div className="card soft mt small muted" data-testid="verify">Para comprobar la canción, ponela vos (estás en música manual).</div>;
  }
  const listen = async (from = pos) => {
    setErr(undefined);
    try {
      if (!player.ready) await player.init();
      setPlaying(true);
      await player.play(uri, from, 60_000);
    } catch (e) {
      setErr((e as Error).message);
      setPlaying(false);
    }
  };
  const stop = () => { setPlaying(false); void player.stop(); };

  return (
    <div className="card soft mt" data-testid="verify">
      <h3>Comprobar la canción</h3>
      <p className="muted small">Escuchá desde donde quieras para comparar con lo que cantaron. Si suena por el parlante lo oyen todos: mejor con auriculares.</p>
      <label htmlFor="verify-pos">Desde {mmss(pos)} de {mmss(durationMs)}</label>
      <input id="verify-pos" type="range" min={0} max={max} step={1000} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
      <div className="row mt">
        <button className="btn sm" onClick={() => setPos(clamp(pos - 10_000))}>−10 s</button>
        <button className="btn sm" onClick={() => setPos(clamp(pos + 10_000))}>+10 s</button>
        <button className="btn sm" onClick={() => setPos(startMs)}>Inicio del fragmento</button>
        <span className="grow" />
        <button className="btn sm primary" onClick={() => void listen()}>🎧 Escuchar desde acá</button>
        <button className="btn sm" disabled={!playing} onClick={stop}>■ Parar</button>
      </div>
      {err && <div className="error small mt">{err}</div>}
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
  preview: 'Vista previa',
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
  const [mode, setMode] = useState<PlayerModeSetting>(() => player?.mode ?? loadPlayerMode() ?? defaultPlayerMode());
  useEffect(() => { if (player) setMode(player.mode); }, [player]);
  // Spotify Connect: en qué aparato suena. Se elige acá mismo, sin volver al lobby.
  const [devs, setDevs] = useState<Device[]>([]);
  const [devId, setDevId] = useState<string>(() => player?.deviceId ?? loadConnectDevice() ?? '');
  const loadDevs = async () => {
    try {
      const ds = await phoneDevices();
      setDevs(ds);
      setDevId((cur) => (ds.some((d) => d.id === cur) ? cur : player?.deviceId ?? ds.find((d) => d.name === loadPreferredDevice().name)?.id ?? ds.find((d) => d.is_active)?.id ?? ds[0]?.id ?? ''));
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (mode === 'connect' && ctx.loggedIn) void loadDevs(); }, [mode, ctx.loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = async () => {
    setErr(undefined); setBusy(true);
    try {
      // Siempre uno nuevo: "Reactivar" sobre un reproductor que figura listo
      // pero ya no responde (desconectado, otro dispositivo) tiene que
      // reconectarlo de verdad. setPlayer cierra el anterior.
      const chosen = devs.find((d) => d.id === devId);
      if (mode === 'connect' && chosen) saveConnectDevice(chosen.id, chosen.name);
      const p = mode === 'manual' ? new ManualPlayer() : mode === 'preview' ? new PreviewPlayer() : mode === 'sdk' ? new SdkPlayer() : new ConnectPlayer(chosen, loadPreferredDevice());
      p.onStatus = ctx.setPlayerStatus;
      ctx.setPlayer(p);
      savePlayerMode(mode);
      await p.init();
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
          {sdkSupported() && <option value="sdk">{isIOS() ? 'Suena en este celular (canción completa)' : 'Suena en este navegador'}</option>}
          <option value="preview">Vista previa en este aparato (30 s)</option>
          <option value="connect">App de Spotify (Connect)</option>
          <option value="manual">Música manual (sin Spotify)</option>
        </select>
        <button className="btn sm primary" disabled={busy || (mode !== 'manual' && mode !== 'preview' && !ctx.loggedIn)} onClick={activate}>
          {busy ? '…' : mode === 'connect' && player?.mode === 'connect' && devId && devId !== player.deviceId ? 'Usar este aparato' : player?.ready ? 'Reactivar' : 'Activar'}
        </button>
      </div>
      {mode === 'connect' && ctx.loggedIn && (
        <>
          <div className="row mt">
            <select aria-label="Celular de Spotify" value={devId} onChange={(e) => setDevId(e.target.value)} className="grow">
              {devs.length === 0 && <option value="">Abrí Spotify en tu iPhone y tocá Buscar</option>}
              {devs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.type}){d.is_active ? ' · activo' : ''}</option>)}
            </select>
            <button className="btn sm" onClick={() => void loadDevs()}>Buscar</button>
          </div>
          {isIOS() && <p className="muted small mt">En iPhone los efectos de sonido del juego quedan apagados: si sonaran, el iPhone le cortaría la música a Spotify.</p>}
          <p className="muted small mt">Para que suene en este celular: abrí la app de Spotify acá, poné play en cualquier tema, volvé a esta página, tocá Buscar, elegí el celular y tocá «Usar este aparato».</p>
        </>
      )}
      {mode !== 'manual' && mode !== 'preview' && !ctx.loggedIn && <div className="error small mt">Sin sesión de Spotify. Terminá la partida y conectala en el lobby, o usá música manual.</div>}
      {err && <div className="error small mt">{err}</div>}
    </div>
  );
}
