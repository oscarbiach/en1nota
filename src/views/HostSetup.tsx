import { useEffect, useState } from 'react';
import type { HostCtx } from './hostCtx';
import type { Settings, Track } from '../game/types';
import * as E from '../game/engine';
import { beginLogin, getClientId, logout, redirectUri, setClientId } from '../spotify/auth';
import { getMe, phoneDevices, type Device, type Me } from '../spotify/api';
import { ConnectPlayer, ManualPlayer, PreviewPlayer, SdkPlayer, defaultPlayerMode, isIOS, sdkSupported } from '../spotify/player';
import { saveConnectDevice, loadConnectDevice, loadPlayerMode, savePlayerMode, saveSettings, type PlayerModeSetting } from '../storage/store';
import { PlaylistEditor } from './PlaylistEditor';
import { RoomQr } from '../components/RoomQr';
import { joinUrl, screenUrl } from '../net/protocol';
import { navigate } from '../router';
import { secs } from '../util/format';

export function HostSetup({ ctx, setTracks, authError }: { ctx: HostCtx; setTracks: (t: Track[]) => void; authError?: string }) {
  const { game, update, room, online } = ctx;
  const [tab, setTab] = useState<'spotify' | 'jugadores' | 'lista' | 'reglas'>(ctx.loggedIn ? 'jugadores' : 'spotify');
  // Música manual y vista previa no necesitan la sesión de Spotify para jugar.
  const manual = ctx.player?.mode === 'manual' || ctx.player?.mode === 'preview';
  const ready = (ctx.loggedIn || manual) && game.tracks.length > 0 && E.validPlayerCount(game);
  const [startErr, setStartErr] = useState<string>();
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStartErr(undefined); setStarting(true);
    try {
      // El reproductor necesita un gesto del usuario: este click sirve.
      if (ctx.player && !ctx.player.ready) {
        try {
          await ctx.player.init();
        } catch (e) {
          // iPhone: si Spotify no deja sonar la canción completa, se juega con
          // Vista previa (se habilita con el primer Sonar, que es otro toque).
          if (ctx.player.mode !== 'sdk' || !isIOS()) throw e;
          const v = new PreviewPlayer();
          v.onStatus = ctx.setPlayerStatus;
          ctx.setPlayer(v);
          ctx.setPlayerStatus(`En este iPhone Spotify no dejó sonar la canción completa (${(e as Error).message}). Se usa «Vista previa» (30 s de muestra).`);
        }
      }
      ctx.sfx('start');
      update(E.startGame);
    } catch (e) {
      setStartErr(`No se pudo activar el reproductor: ${(e as Error).message}. Revisá la pestaña Spotify.`);
      setTab('spotify');
    } finally { setStarting(false); }
  };

  return (
    <div className="page wide">
      <div className="row between mb">
        <div className="row">
          <button className="btn sm ghost" onClick={() => navigate('/')}>← Inicio</button>
          <h1 style={{ margin: 0 }}>Armá tu partida</h1>
        </div>
        <div className="row">
          <span className={`pill ${online ? 'on' : 'off'}`}>{online ? `Sala ${room ?? '…'}` : 'Sin conexión a la sala'}</span>
          <span className={`pill ${ctx.loggedIn ? 'on' : 'off'}`}>{ctx.loggedIn ? 'Spotify OK' : 'Sin Spotify'}</span>
        </div>
      </div>

      {authError && <div className="error mb">{authError}</div>}
      <div className="mode-picker" aria-label="Modo de juego">
        {([
          ['party', 'La juntada', 'Hasta 8 · con juez'],
          ['solo', 'Solitario', 'Tu oído contra la música'],
          ['duel', '1 contra 1', 'Dos jugadores · sin juez extra']
        ] as const).map(([mode, title, desc]) => <button key={mode} className={`mode-option ${game.mode === mode || !game.mode && mode === 'party' ? 'selected' : ''}`}
          aria-pressed={(game.mode ?? 'party') === mode} onClick={() => { update((g) => ({ ...g, mode })); setTab('jugadores'); }}>
          <b>{title}</b><span>{desc}</span>
        </button>)}
      </div>
      {ctx.serverFull && !room && <div className="error mb" role="alert">El servidor está lleno en este momento y no puede abrir más salas. Se vuelve a intentar solo cada 30 segundos.</div>}

      <div className="tabs">
        <button className={tab === 'spotify' ? 'on' : ''} onClick={() => setTab('spotify')}>1 · Spotify</button>
        <button className={tab === 'jugadores' ? 'on' : ''} onClick={() => setTab('jugadores')}>2 · Jugadores ({game.players.length})</button>
        <button className={tab === 'lista' ? 'on' : ''} onClick={() => setTab('lista')}>3 · Canciones ({game.tracks.length})</button>
        <button className={tab === 'reglas' ? 'on' : ''} onClick={() => setTab('reglas')}>4 · Reglas</button>
      </div>

      {tab === 'spotify' && <SpotifyTab ctx={ctx} />}
      {tab === 'jugadores' && <PlayersTab ctx={ctx} />}
      {tab === 'lista' && <PlaylistEditor ctx={ctx} tracks={game.tracks} setTracks={setTracks} />}
      {tab === 'reglas' && <RulesTab settings={game.settings} onChange={(s) => { saveSettings(s); update((g) => ({ ...g, settings: s })); }} />}

      {startErr && <div className="error mt">{startErr}</div>}
      <div className="card mt row between">
        <div className="muted small">
          {!ctx.loggedIn && !manual ? 'Falta conectar Spotify (o elegí "sin reproductor"). ' : ''}
          {game.players.length === 0 ? 'Falta al menos un jugador. ' : ''}
          {game.players.length > E.playerLimit(game) ? `Este modo admite ${E.playerLimit(game)}: quitá los jugadores que sobran. ` : ''}
          {game.mode === 'duel' && game.players.length < 2 ? 'El duelo necesita dos jugadores. ' : ''}
          {game.tracks.length === 0 ? 'Falta cargar canciones. ' : ''}
          {ready ? `${game.players.length} jugadores · ${game.tracks.length} temas · fragmentos ${game.settings.steps.map(secs).join(' → ')}` : ''}
        </div>
        <button className="btn primary xl" disabled={!ready || starting} onClick={start}>{starting ? 'Activando reproductor…' : '¡Empezar!'}</button>
      </div>
    </div>
  );
}

function SpotifyTab({ ctx }: { ctx: HostCtx }) {
  const [clientId, setCid] = useState(getClientId());
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string>();
  const [mode, setMode] = useState<PlayerModeSetting>(loadPlayerMode() ?? defaultPlayerMode());
  const [devs, setDevs] = useState<Device[]>([]);
  const [devId, setDevId] = useState<string>(loadConnectDevice() ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ctx.loggedIn) return;
    getMe().then(setMe).catch((e: Error) => { setErr(e.message); if (/401|sesión/i.test(e.message)) { logout(); ctx.setLoggedIn(false); } });
  }, [ctx.loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDevices = async () => {
    try { const d = await phoneDevices(); setDevs(d); if (!devId && d[0]) setDevId(d.find((x) => x.is_active)?.id ?? d[0].id); }
    catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (ctx.loggedIn && mode === 'connect') void refreshDevices(); }, [ctx.loggedIn, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = async () => {
    setErr(undefined); setBusy(true);
    try {
      savePlayerMode(mode);
      let p;
      if (mode === 'manual') p = new ManualPlayer();
      else if (mode === 'preview') p = new PreviewPlayer();
      else if (mode === 'sdk') p = new SdkPlayer();
      else {
        const d = devs.find((x) => x.id === devId);
        if (d) saveConnectDevice(d.id, d.name);
        p = new ConnectPlayer(d);
      }
      p.onStatus = ctx.setPlayerStatus;
      ctx.setPlayer(p);
      await p.init();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  const test = async () => {
    if (!ctx.player?.ready) return;
    setErr(undefined);
    try { await ctx.player.playSnippet('spotify:track:4uLU6hMCjMI75M1A2tKUQC', 0, 1500); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="grid2">
      <div className="card">
        <h2>Cuenta de Spotify</h2>
        {!ctx.loggedIn ? (
          <>
            <p className="muted small">
              Se usa el Spotify <b>Premium</b> del juez. Una sola vez hay que crear una app en el
              {' '}<a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Dashboard de Spotify</a> y pegar acá su Client ID.
              En la app, agregá como Redirect URI exactamente: <code>{redirectUri()}</code>
            </p>
            <div className="field"><label htmlFor="cfg-client-id">Client ID</label><input id="cfg-client-id" value={clientId} onChange={(e) => setCid(e.target.value)} placeholder="32 caracteres" /></div>
            <button className="btn primary" disabled={clientId.trim().length < 20} onClick={() => { setClientId(clientId); beginLogin('#/juez').catch((e: Error) => setErr(e.message)); }}>Conectar con Spotify</button>
          </>
        ) : (
          <>
            <div className="row">
              {me?.images?.[0] && <img src={me.images[0].url} alt="" style={{ width: 44, height: 44, borderRadius: 22 }} />}
              <div className="grow">
                <b>{me?.display_name ?? '…'}</b>
                <div className={`small ${me && me.product !== 'premium' ? 'error' : 'muted'}`}>
                  {me ? (me.product === 'premium' ? 'Premium ✓' : `Cuenta ${me.product}: sin Premium no se puede reproducir`) : ''}
                </div>
              </div>
              <button className="btn sm" onClick={() => { logout(); ctx.setPlayer(null); ctx.setLoggedIn(false); }}>Salir</button>
            </div>
          </>
        )}
        {err && <div className="error mt small">{err}</div>}
      </div>

      <div className="card">
        <h2>Reproductor</h2>
        <p className="muted small">Dónde suena la música. El estado actual: <b>{ctx.playerStatus}</b></p>
        <div className="field">
          <label><input type="radio" checked={mode === 'sdk'} disabled={!sdkSupported()} onChange={() => setMode('sdk')} />
            <b>Suena en este navegador</b>: la música sale por este aparato (la compu o el celu del juez, o el parlante conectado a él). {isIOS() ? 'En iPhone: canción completa si Spotify lo permite en este celular; si no, la app pasa sola a Vista previa.' : sdkSupported() ? 'Recomendado: los fragmentos cortos son exactos.' : 'No disponible en este navegador.'}
          </label>
          <label><input type="radio" checked={mode === 'preview'} onChange={() => setMode('preview')} />
            <b>Vista previa en este aparato</b>: suenan los 30 s de muestra que Spotify publica de cada tema, dentro de esta página. {isIOS() ? 'Recomendado en iPhone.' : 'Sirve en cualquier celular.'} El fragmento arranca donde arranca la muestra (no en el punto de inicio de la lista) y algunos temas no tienen muestra.
          </label>
          <label><input type="radio" checked={mode === 'connect'} onChange={() => setMode('connect')} />
            <b>App de Spotify en el celular (Spotify Connect)</b>: la música sale por la app de Spotify de tu celular y esta página la maneja como control remoto. Para iPhone. Solo se usan celulares: nunca parlantes ni TVs de la cuenta. Los fragmentos de menos de 1 s salen imprecisos.
          </label>
          <label><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />
            Sin reproductor: <b>música manual</b>. La ponés vos por tu cuenta; la app solo cuenta el tiempo, los pulsadores y el puntaje.
          </label>
        </div>
        {mode === 'connect' && (
          <div className="field row">
            <select aria-label="Dispositivo de Spotify" value={devId} onChange={(e) => setDevId(e.target.value)} className="grow">
              {devs.length === 0 && <option value="">Abrí Spotify en tu iPhone y tocá Actualizar…</option>}
              {devs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.type}){d.is_active ? ' · activo' : ''}</option>)}
            </select>
            <button className="btn sm" onClick={refreshDevices}>Actualizar</button>
          </div>
        )}
        <div className="row">
          <button className="btn primary" disabled={(!ctx.loggedIn && mode !== 'manual' && mode !== 'preview') || busy} onClick={activate}>{busy ? 'Activando…' : 'Activar reproductor'}</button>
          <button className="btn" disabled={!ctx.player?.ready || mode === 'manual'} onClick={test}>Probar 1,5 s</button>
          <label className="row" style={{ margin: 0 }}><input type="checkbox" checked={ctx.localSfx} onChange={(e) => ctx.setLocalSfx(e.target.checked)} />Efectos de sonido acá</label>
        </div>
      </div>
    </div>
  );
}

function PlayersTab({ ctx }: { ctx: HostCtx }) {
  const { game, update, room } = ctx;
  const [name, setName] = useState('');
  const limit = E.playerLimit(game);
  const add = () => { if (!name.trim() || game.players.length >= limit) return; update((g) => E.addPlayer(g, name)); setName(''); };

  return (
    <div className={game.mode === 'solo' ? 'solo-setup' : 'grid2'}>
      {game.mode !== 'solo' && <div className="card">
        <h2>Con celulares</h2>
        {room ? (
          <div className="col" style={{ alignItems: 'center' }}>
            <div className="code">{room}</div>
            <RoomQr url={joinUrl(room)} size={220} />
            <div className="muted small">Entran a <b>{location.host}</b> con el código, o escanean el QR.</div>
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(joinUrl(room))}>Copiar link</button>
          </div>
        ) : <p className="muted">Conectando a la sala…</p>}
        <hr style={{ borderColor: 'var(--line)', margin: '14px 0' }} />
        <h2>Pantalla de TV</h2>
        <p className="muted small">Abrí esto en la tele o notebook conectada:</p>
        {room && <div className="row"><input readOnly aria-label="Link de la pantalla de TV" value={screenUrl(room)} onFocus={(e) => e.target.select()} /><button className="btn sm" onClick={() => window.open(screenUrl(room), '_blank')}>Abrir</button></div>}
      </div>}

      <div className="card">
        <h2>Jugadores ({game.players.length}/{limit})</h2>
        {game.mode === 'solo' && <div className="mode-help">
          <p>Agregate abajo y jugá desde esta pantalla.</p>
          <label htmlFor="solo-answer">Cómo querés responder</label>
          <select id="solo-answer" value={game.soloAnswer ?? 'write'} onChange={(e) => update((g) => ({ ...g, soloAnswer: e.target.value as 'write' | 'self' }))}>
            <option value="write">Escribir la canción · 30 segundos</option><option value="self">Autoevaluación · sin reloj</option>
          </select>
          <p className="small muted mt">{game.soloAnswer === 'self' ? 'Decís o cantás tu respuesta, la comprobás y marcás si acertaste.' : 'Un intento por tema. El reloj arranca al escuchar y no se reinicia al repetir. No importan tildes, signos ni mayúsculas.'}</p>
        </div>}
        {game.mode === 'duel' && <p className="mode-help">Usen dos celulares o las teclas 1 y 2. Antes de comprobar el título, ambos deben tocar y decir su respuesta si quieren participar. El primero que acierta se lleva el punto.</p>}
        {game.mode !== 'solo' && <p className="muted small">Los que entran por celu aparecen solos. También podés agregar a mano para el <b>modo mesa</b>: pulsadores en esta pantalla con teclas 1-8.</p>}
        <div className="row mb">
          <input aria-label="Nombre del jugador nuevo" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" maxLength={24} onKeyDown={(e) => e.key === 'Enter' && add()} className="grow" />
          <button className="btn" disabled={!name.trim() || game.players.length >= limit} onClick={add}>Agregar</button>
        </div>
        <ul className="list">
          {game.players.map((p) => (
            <li key={p.id} className="item">
              <span className="dot" style={{ background: p.color }} />
              <div className="t">
                <input aria-label={`Nombre del jugador ${p.key ?? ''}`} value={p.name} onChange={(e) => update((g) => E.renamePlayer(g, p.id, e.target.value))} style={{ minHeight: 34, padding: '4px 8px', background: 'transparent', border: 'none' }} />
              </div>
              <span className="pill">{ctx.peers.has(p.id) ? (p.connected ? '📱 celu' : '📴 desconectado') : `⌨️ tecla ${p.key}`}</span>
              <button className="btn sm ghost" aria-label={`Quitar a ${p.name}`} onClick={() => ctx.kick(p.id)}>✕</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RulesTab({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [stepsText, setStepsText] = useState(settings.steps.map((s) => s / 1000).join(', '));
  const [pointsText, setPointsText] = useState(settings.pointsCorrect.join(', '));
  const parseList = (t: string) => t.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
  const applySteps = () => { const s = parseList(stepsText).map((x) => Math.round(x * 1000)).filter((x) => x >= 100); if (s.length) onChange({ ...settings, steps: s }); };
  const applyPoints = () => { const p = parseList(pointsText); if (p.length) onChange({ ...settings, pointsCorrect: p }); };

  return (
    <div className="grid2">
      <div className="card">
        <h2>Fragmentos</h2>
        <div className="field">
          <label htmlFor="cfg-steps">Duración de cada pasada, en segundos (si nadie acierta, la siguiente es más larga)</label>
          <input id="cfg-steps" value={stepsText} onChange={(e) => setStepsText(e.target.value)} onBlur={applySteps} placeholder="0.4, 1.2, 3, 8" />
          <div className="steps mt">{settings.steps.map((s, i) => <span key={i} className="on">{secs(s)}</span>)}</div>
        </div>
        <div className="field">
          <label htmlFor="cfg-reveal">Cuántos segundos suena la canción al revelarla</label>
          <input id="cfg-reveal" type="number" min={3} max={60} value={settings.revealMs / 1000} onChange={(e) => onChange({ ...settings, revealMs: Math.max(3, Number(e.target.value)) * 1000 })} />
        </div>
        <div className="field">
          <label htmlFor="cfg-window">Ventana de empate (ms): pulsaciones dentro de este margen se ordenan por hora de llegada al servidor</label>
          <input id="cfg-window" type="number" min={0} max={1000} step={50} value={settings.buzzWindowMs} onChange={(e) => onChange({ ...settings, buzzWindowMs: Math.max(0, Number(e.target.value)) })} />
        </div>
        <label className="row"><input type="checkbox" checked={settings.shuffleOnStart} onChange={(e) => onChange({ ...settings, shuffleOnStart: e.target.checked })} />Mezclar la lista al empezar cada partida (apagalo para respetar el orden de la lista)</label>
      </div>
      <div className="card">
        <h2>Puntos</h2>
        <div className="field">
          <label htmlFor="cfg-points">Por acertar en cada pasada (uno solo = siempre lo mismo)</label>
          <input id="cfg-points" value={pointsText} onChange={(e) => setPointsText(e.target.value)} onBlur={applyPoints} placeholder="1  ó  3, 2, 1" />
        </div>
        <div className="row">
          <div className="field grow"><label htmlFor="cfg-wrong">Por fallar / quedarse en blanco</label><input id="cfg-wrong" type="number" value={settings.pointsWrong} onChange={(e) => onChange({ ...settings, pointsWrong: Number(e.target.value) })} /></div>
        </div>
        <label className="row"><input type="checkbox" checked={settings.lockOnFail} onChange={(e) => onChange({ ...settings, lockOnFail: e.target.checked })} />El que falla queda bloqueado en ese tema</label>
      </div>
    </div>
  );
}
