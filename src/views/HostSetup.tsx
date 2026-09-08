import { useEffect, useState } from 'react';
import type { HostCtx } from './Host';
import type { Settings, Track } from '../game/types';
import * as E from '../game/engine';
import { beginLogin, getClientId, logout, redirectUri, setClientId } from '../spotify/auth';
import { getMe, devices, type Device, type Me } from '../spotify/api';
import { ConnectPlayer, ManualPlayer, SdkPlayer, sdkSupported } from '../spotify/player';
import { saveConnectDevice, loadConnectDevice, loadPlayerMode, savePlayerMode, saveSettings, type PlayerModeSetting } from '../storage/store';
import { PlaylistEditor } from './PlaylistEditor';
import { RoomQr } from '../components/RoomQr';
import { joinUrl, screenUrl } from '../net/protocol';
import { navigate } from '../App';
import { secs } from '../util/format';

export function HostSetup({ ctx, setTracks, authError }: { ctx: HostCtx; setTracks: (t: Track[]) => void; authError?: string }) {
  const { game, update, room, online } = ctx;
  const [tab, setTab] = useState<'spotify' | 'jugadores' | 'lista' | 'reglas'>(ctx.loggedIn ? 'jugadores' : 'spotify');
  const manual = ctx.player instanceof ManualPlayer;
  const ready = (ctx.loggedIn || manual) && game.tracks.length > 0 && game.players.length > 0;

  return (
    <div className="page wide">
      <div className="row between mb">
        <div className="row">
          <button className="btn sm ghost" onClick={() => navigate('/')}>← Inicio</button>
          <h1 style={{ margin: 0 }}>Panel del juez</h1>
        </div>
        <div className="row">
          <span className={`pill ${online ? 'on' : 'off'}`}>{online ? `Sala ${room ?? '…'}` : 'Sin conexión a la sala'}</span>
          <span className={`pill ${ctx.loggedIn ? 'on' : 'off'}`}>{ctx.loggedIn ? 'Spotify OK' : 'Sin Spotify'}</span>
        </div>
      </div>

      {authError && <div className="error mb">{authError}</div>}

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

      <div className="card mt row between">
        <div className="muted small">
          {!ctx.loggedIn && !manual ? 'Falta conectar Spotify (o elegí "sin reproductor"). ' : ''}
          {game.players.length === 0 ? 'Falta al menos un jugador. ' : ''}
          {game.tracks.length === 0 ? 'Falta cargar canciones. ' : ''}
          {ready ? `${game.players.length} jugadores · ${game.tracks.length} temas · fragmentos ${game.settings.steps.map(secs).join(' → ')}` : ''}
        </div>
        <button className="btn primary xl" disabled={!ready} onClick={() => { ctx.sfx('start'); update(E.startGame); }}>¡Empezar!</button>
      </div>
    </div>
  );
}

function SpotifyTab({ ctx }: { ctx: HostCtx }) {
  const [clientId, setCid] = useState(getClientId());
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string>();
  const [mode, setMode] = useState<PlayerModeSetting>(loadPlayerMode() ?? (sdkSupported() ? 'sdk' : 'connect'));
  const [devs, setDevs] = useState<Device[]>([]);
  const [devId, setDevId] = useState<string>(loadConnectDevice() ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ctx.loggedIn) return;
    getMe().then(setMe).catch((e: Error) => { setErr(e.message); if (/401|sesión/i.test(e.message)) { logout(); ctx.setLoggedIn(false); } });
  }, [ctx.loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDevices = async () => {
    try { const d = await devices(); setDevs(d); if (!devId && d[0]) setDevId(d.find((x) => x.is_active)?.id ?? d[0].id); }
    catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (ctx.loggedIn && mode === 'connect') void refreshDevices(); }, [ctx.loggedIn, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = async () => {
    setErr(undefined); setBusy(true);
    try {
      savePlayerMode(mode);
      let p;
      if (mode === 'manual') p = new ManualPlayer();
      else if (mode === 'sdk') p = new SdkPlayer();
      else {
        const d = devs.find((x) => x.id === devId);
        if (d) saveConnectDevice(d.id);
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
            <div className="field"><label>Client ID</label><input value={clientId} onChange={(e) => setCid(e.target.value)} placeholder="32 caracteres" /></div>
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
            En este navegador {sdkSupported() ? '(recomendado, fragmentos exactos)' : '(no disponible en iPhone/iPad)'}
          </label>
          <label><input type="radio" checked={mode === 'connect'} onChange={() => setMode('connect')} />
            En la app de Spotify de otro dispositivo (Spotify Connect). Fragmentos de menos de 1 s salen imprecisos.
          </label>
          <label><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />
            Sin reproductor: la música la pongo yo. La app solo cuenta el tiempo, los pulsadores y el puntaje.
          </label>
        </div>
        {mode === 'connect' && (
          <div className="field row">
            <select value={devId} onChange={(e) => setDevId(e.target.value)} className="grow">
              {devs.length === 0 && <option value="">Abrí Spotify en algún dispositivo…</option>}
              {devs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.type}){d.is_active ? ' · activo' : ''}</option>)}
            </select>
            <button className="btn sm" onClick={refreshDevices}>Actualizar</button>
          </div>
        )}
        <div className="row">
          <button className="btn primary" disabled={(!ctx.loggedIn && mode !== 'manual') || busy} onClick={activate}>{busy ? 'Activando…' : 'Activar reproductor'}</button>
          <button className="btn" disabled={!ctx.player?.ready || mode === 'manual'} onClick={test}>Probar 1,5 s</button>
          <label className="row" style={{ margin: 0 }}><input type="checkbox" checked={ctx.localSfx} onChange={(e) => ctx.setLocalSfx(e.target.checked)} />Efectos de sonido acá</label>
        </div>
      </div>
    </div>
  );
}

function PlayersTab({ ctx }: { ctx: HostCtx }) {
  const { game, update, room, conn } = ctx;
  const [name, setName] = useState('');
  const add = () => { if (!name.trim() || game.players.length >= 8) return; update((g) => E.addPlayer(g, name)); setName(''); };

  return (
    <div className="grid2">
      <div className="card">
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
        {room && <div className="row"><input readOnly value={screenUrl(room)} onFocus={(e) => e.target.select()} /><button className="btn sm" onClick={() => window.open(screenUrl(room), '_blank')}>Abrir</button></div>}
      </div>

      <div className="card">
        <h2>Jugadores ({game.players.length}/8)</h2>
        <p className="muted small">Los que entran por celu aparecen solos. También podés agregar a mano para el <b>modo mesa</b>: pulsadores en esta pantalla con teclas 1-8.</p>
        <div className="row mb">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" maxLength={24} onKeyDown={(e) => e.key === 'Enter' && add()} className="grow" />
          <button className="btn" disabled={!name.trim() || game.players.length >= 8} onClick={add}>Agregar</button>
        </div>
        <ul className="list">
          {game.players.map((p) => (
            <li key={p.id} className="item">
              <span className="dot" style={{ background: p.color }} />
              <div className="t">
                <input value={p.name} onChange={(e) => update((g) => E.renamePlayer(g, p.id, e.target.value))} style={{ minHeight: 34, padding: '4px 8px', background: 'transparent', border: 'none' }} />
              </div>
              <span className="pill">{ctx.peers.has(p.id) ? (p.connected ? '📱 celu' : '📴 desconectado') : `⌨️ tecla ${p.key}`}</span>
              <button className="btn sm ghost" onClick={() => { if (ctx.peers.has(p.id)) conn.kick(p.id); update((g) => E.removePlayer(g, p.id)); }}>✕</button>
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
          <label>Duración de cada pasada, en segundos (si nadie acierta, la siguiente es más larga)</label>
          <input value={stepsText} onChange={(e) => setStepsText(e.target.value)} onBlur={applySteps} placeholder="0.4, 1.2, 3, 8" />
          <div className="steps mt">{settings.steps.map((s, i) => <span key={i} className="on">{secs(s)}</span>)}</div>
        </div>
        <div className="field">
          <label>Cuántos segundos suena la canción al revelarla</label>
          <input type="number" min={3} max={60} value={settings.revealMs / 1000} onChange={(e) => onChange({ ...settings, revealMs: Math.max(3, Number(e.target.value)) * 1000 })} />
        </div>
        <div className="field">
          <label>Ventana de empate (ms): pulsaciones dentro de este margen se ordenan por reloj sincronizado</label>
          <input type="number" min={0} max={1000} step={50} value={settings.buzzWindowMs} onChange={(e) => onChange({ ...settings, buzzWindowMs: Math.max(0, Number(e.target.value)) })} />
        </div>
      </div>
      <div className="card">
        <h2>Puntos</h2>
        <div className="field">
          <label>Por acertar en cada pasada (uno solo = siempre lo mismo)</label>
          <input value={pointsText} onChange={(e) => setPointsText(e.target.value)} onBlur={applyPoints} placeholder="1  ó  3, 2, 1" />
        </div>
        <div className="row">
          <div className="field grow"><label>Por fallar / quedarse en blanco</label><input type="number" value={settings.pointsWrong} onChange={(e) => onChange({ ...settings, pointsWrong: Number(e.target.value) })} /></div>
          <div className="field grow"><label>Por tararear</label><input type="number" value={settings.pointsHum} onChange={(e) => onChange({ ...settings, pointsHum: Number(e.target.value) })} /></div>
        </div>
        <label className="row"><input type="checkbox" checked={settings.lockOnFail} onChange={(e) => onChange({ ...settings, lockOnFail: e.target.checked })} />El que falla queda bloqueado en ese tema</label>
      </div>
    </div>
  );
}
