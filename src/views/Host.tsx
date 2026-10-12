// Controlador del juez: estado de partida, sala, reproductor y difusión.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, Track } from '../game/types';
import * as E from '../game/engine';
import { HostConnection } from '../net/host';
import type { PeerInfo, SfxName } from '../net/protocol';
import { ConnectPlayer, ManualPlayer, SdkPlayer, sdkSupported, type SnippetPlayer } from '../spotify/player';
import { isLoggedIn } from '../spotify/auth';
import { loadGame, loadPlayerMode, loadSettings, pushHistory, saveGame } from '../storage/store';
import { playSfx } from '../audio/sfx';
import { HostSetup } from './HostSetup';
import { HostPlay } from './HostPlay';
import { Podium } from '../components/Podium';
import { setMemoryBackup } from '../components/StorageBanner';
import { navigate } from '../App';

export interface JoinRequest {
  pid: string;
  name: string;
}

export interface HostCtx {
  game: GameState;
  update: (fn: (g: GameState) => GameState) => void;
  room?: string;
  online: boolean;
  peers: Map<string, PeerInfo>;
  conn: HostConnection;
  player: SnippetPlayer | null;
  playerStatus: string;
  setPlayer: (p: SnippetPlayer | null) => void;
  setPlayerStatus: (s: string) => void;
  localSfx: boolean;
  setLocalSfx: (v: boolean) => void;
  sfx: (name: SfxName, playerId?: string) => void;
  /** Pulsación (de celu o de pantalla), con instante en reloj del servidor. */
  buzz: (pid: string, at: number) => void;
  /**
   * Hora del servidor según el reloj sincronizado del juez (B03). Inicio del
   * fragmento y pulsaciones usan esta misma base, así la reacción no depende
   * de cuán desfasado esté el reloj de la compu del juez.
   */
  now: () => number;
  /** Saca a un jugador: de la partida y de la sala. */
  kick: (pid: string) => void;
  /** Celulares que piden entrar con la partida empezada. */
  joinRequests: JoinRequest[];
  /** `target`: id del jugador que retoma, 'new' para sumarlo, 'reject' para rechazar. */
  resolveJoin: (pid: string, target: string) => void;
  /** Código anterior si la sala cambió durante la partida. */
  roomChangedFrom?: string;
  dismissRoomChanged: () => void;
  loggedIn: boolean;
  setLoggedIn: (v: boolean) => void;
}

export function Host({ authError }: { authError?: string }) {
  const [game, setGame] = useState<GameState>(() => {
    const saved = loadGame();
    if (saved) return E.restoreGame(saved);
    return E.newGame({ settings: { ...E.newGame().settings, ...loadSettings() } });
  });
  const gameRef = useRef(game);
  gameRef.current = game;
  // B04: el respaldo descargable incluye la partida en memoria, aunque no se haya podido guardar.
  useEffect(() => { setMemoryBackup(() => ({ game: gameRef.current })); }, []);

  const [room, setRoom] = useState<string>();
  const [online, setOnline] = useState(false);
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  const [player, setPlayerState] = useState<SnippetPlayer | null>(null);
  const [playerStatus, setPlayerStatus] = useState('Sin reproductor');
  const [localSfx, setLocalSfx] = useState(true);
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [replaced, setReplaced] = useState(false);
  /** Código anterior si la sala cambió (servidor reiniciado sin ROOM_SECRET). */
  const [roomChangedFrom, setRoomChangedFrom] = useState<string>();
  /** Celulares que entraron con la partida empezada y esperan que el juez diga quiénes son. */
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const buzzTimer = useRef<number>(undefined);
  const connRef = useRef<HostConnection>(null);

  const update = useCallback((fn: (g: GameState) => GameState) => {
    setGame((g) => fn(g));
  }, []);

  // --- sala ---
  const conn = useMemo(() => {
    const c = new HostConnection({
      onRoom: (r, previous) => {
        setRoom(r);
        if (previous) setRoomChangedFrom(previous);
      },
      onOnline: setOnline,
      onReplaced: () => setReplaced(true),
      onRoster: (list) => {
        // La lista del servidor es la verdad: un celular que no está en ella
        // no está conectado (p. ej. el servidor se reinició y todavía no volvió).
        setPeers(new Map(list.map((p) => [p.pid, p])));
        const online = new Set(list.filter((p) => p.connected).map((p) => p.pid));
        setGame((g) => ({ ...g, players: g.players.map((p) => (E.isRemotePlayer(p) ? { ...p, connected: online.has(p.id) } : p)) }));
        setJoinRequests((rs) => rs.filter((r) => online.has(r.pid)));
      },
      onPeer: (p) => {
        setPeers((m) => new Map(m).set(p.pid, p));
        setGame((g) => (g.players.some((x) => x.id === p.pid) ? E.setConnected(g, p.pid, p.connected) : g));
        if (!p.connected) setJoinRequests((rs) => rs.filter((r) => r.pid !== p.pid));
      },
      onHello: (pid, role, name) => {
        setPeers((m) => new Map(m).set(pid, { pid, role, name, connected: true }));
        if (role !== 'player') return;
        const g = gameRef.current;
        const existing = g.players.find((x) => x.id === pid);
        if (existing) {
          setGame((cur) => E.setConnected(cur, pid, true));
          c.sendTo(pid, { k: 'welcome', playerId: pid, name: existing.name, color: existing.color });
        } else if (g.phase === 'lobby' && g.players.length < 8) {
          const next = E.addPlayer(g, name, pid, true);
          const pl = next.players[next.players.length - 1];
          setGame((cur) => (cur.players.some((x) => x.id === pid) ? cur : E.addPlayer(cur, name, pid, true)));
          c.sendTo(pid, { k: 'welcome', playerId: pid, name: pl.name, color: pl.color });
        } else if (g.phase === 'lobby') {
          c.sendTo(pid, { k: 'rejected', reason: 'La sala está llena' });
        } else {
          // Partida empezada: el juez decide si es alguien que ya jugaba
          // (conserva su puntaje), un jugador nuevo, o lo rechaza.
          setJoinRequests((rs) => [...rs.filter((r) => r.pid !== pid), { pid, name }]);
          c.sendTo(pid, { k: 'waiting', reason: 'La partida ya empezó: el juez tiene que confirmar quién sos.' });
        }
      },
      onRename: (pid, name) => setGame((g) => E.renamePlayer(g, pid, name)),
      onBuzz: (pid, at) => onBuzz(pid, at)
    });
    connRef.current = c;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    conn.start();
    return () => conn.stop();
  }, [conn]);

  // --- pulsaciones con ventana de empate ---
  const playerRef = useRef<SnippetPlayer | null>(null);
  playerRef.current = player;

  const onBuzz = useCallback((pid: string, at: number) => {
    const g = gameRef.current;
    if (!E.canBuzz(g, pid)) return;
    setGame((cur) => E.receiveBuzz(cur, { playerId: pid, at }));
    if (buzzTimer.current) return;
    buzzTimer.current = window.setTimeout(() => {
      buzzTimer.current = undefined;
      setGame((cur) => {
        const next = E.resolveBuzzes(cur);
        if (next !== cur && next.round.buzzedPlayerId) {
          void playerRef.current?.stop();
          emitSfx('buzz', next.round.buzzedPlayerId, next);
        }
        return next;
      });
    }, g.settings.buzzWindowMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitSfx = useCallback((name: SfxName, playerId?: string, g: GameState = gameRef.current) => {
    connRef.current?.sfx(name, playerId);
    if (localSfxRef.current) {
      const idx = playerId ? Math.max(0, g.players.findIndex((p) => p.id === playerId)) : 0;
      playSfx(name, idx);
    }
  }, []);
  const localSfxRef = useRef(localSfx);
  localSfxRef.current = localSfx;

  // --- persistencia y difusión ---
  useEffect(() => {
    saveGame(game);
    conn.broadcastState(E.toPublic(game));
    if (game.phase === 'finished') pushHistory(game);
  }, [game, conn]);

  const setPlayer = useCallback((p: SnippetPlayer | null) => {
    setPlayerState((old) => { if (old && old !== p) old.destroy(); return p; });
  }, []);

  // Reproductor recordado: solo el tipo, la instancia se crea con un gesto del usuario.
  useEffect(() => {
    if (player) return;
    const mode = loadPlayerMode() ?? (sdkSupported() ? 'sdk' : 'connect');
    if (mode === 'manual') { const m = new ManualPlayer(); m.onStatus = setPlayerStatus; setPlayerState(m); void m.init(); return; }
    if (!loggedIn) return;
    const p = mode === 'sdk' && sdkSupported() ? new SdkPlayer() : new ConnectPlayer();
    p.onStatus = setPlayerStatus;
    setPlayerState(p);
    setPlayerStatus(mode === 'sdk' ? 'Tocá "Activar reproductor"' : 'Tocá "Activar reproductor" con Spotify abierto');
  }, [player, loggedIn]);

  useEffect(() => () => { player?.destroy(); }, [player]);

  const peersRef = useRef(peers);
  peersRef.current = peers;

  const kick = useCallback((pid: string) => {
    // El servidor no avisa la desconexión de un expulsado: lo olvidamos acá
    // para que nunca vuelva a figurar como conectado.
    if (peersRef.current.has(pid)) conn.kick(pid);
    setPeers((m) => { const n = new Map(m); n.delete(pid); return n; });
    setGame((g) => E.removePlayer(g, pid));
  }, [conn]);

  /**
   * "Empezar de cero": lista y puntajes nuevos en la misma sala. Los
   * jugadores de modo mesa se quitan; los celulares conectados se
   * reincorporan con su nombre y reciben su color, así ninguno queda
   * esperando algo que el juez no puede hacer.
   */
  const startFromScratch = () => {
    const prev = gameRef.current;
    const phones = [...peersRef.current.values()].filter((p) => p.role === 'player' && p.connected);
    let next = E.newGame({ settings: prev.settings });
    for (const p of phones.slice(0, 8)) {
      next = E.addPlayer(next, prev.players.find((x) => x.id === p.pid)?.name ?? p.name, p.pid, true);
    }
    setGame(next);
    for (const p of next.players) conn.sendTo(p.id, { k: 'welcome', playerId: p.id, name: p.name, color: p.color });
  };

  const resolveJoin = (pid: string, target: string) => {
    const req = joinRequests.find((r) => r.pid === pid);
    setJoinRequests((rs) => rs.filter((r) => r.pid !== pid));
    if (!req) return;
    const g = gameRef.current;
    if (target === 'reject') {
      conn.sendTo(pid, { k: 'rejected', reason: 'El juez no te sumó a esta partida.' });
      return;
    }
    let next: GameState;
    if (target === 'new') {
      if (g.players.length >= 8) { conn.sendTo(pid, { k: 'rejected', reason: 'La sala está llena' }); return; }
      next = E.addPlayer(g, req.name, pid, true);
    } else {
      next = E.reassignPlayer(g, target, pid);
      if (next === g) return;
      // Si la conexión vieja de ese jugador sigue en la sala, ya no le corresponde.
      if (peersRef.current.get(target)?.connected) conn.kick(target);
    }
    setGame(next);
    const pl = next.players.find((p) => p.id === pid)!;
    conn.sendTo(pid, { k: 'welcome', playerId: pid, name: pl.name, color: pl.color });
  };

  const ctx: HostCtx = {
    game, update, room, online, peers, conn, player, playerStatus, setPlayer, setPlayerStatus,
    localSfx, setLocalSfx, sfx: emitSfx, buzz: onBuzz, now: () => conn.socket.serverNow(), kick, loggedIn, setLoggedIn,
    joinRequests, resolveJoin, roomChangedFrom, dismissRoomChanged: () => setRoomChangedFrom(undefined)
  };

  const setTracks = (tracks: Track[]) => update((g) => ({ ...g, tracks }));

  if (replaced) {
    return (
      <div className="overlay">
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>La sala se abrió en otro lado</h2>
          <p className="muted">Este panel del juez se abrió en otra pestaña o dispositivo, y la sala {room} ahora se maneja desde ahí. Esta pestaña ya no controla la partida.</p>
          <button className="btn primary block" onClick={() => location.reload()}>Retomar la sala acá</button>
        </div>
      </div>
    );
  }

  if (game.phase === 'lobby') return <HostSetup ctx={ctx} setTracks={setTracks} authError={authError} />;

  if (game.phase === 'finished') {
    return (
      <div className="page">
        <div className="row between mb">
          <h1>Fin de la partida</h1>
          <span className="pill">{room ? `Sala ${room}` : 'Sin sala'}</span>
        </div>
        <Podium game={game} />
        <div className="row mt">
          <button className="btn primary xl" onClick={() => update((g) => ({ ...E.newGame({ settings: g.settings, tracks: g.tracks, players: g.players.map((p) => ({ ...p, score: 0 })) }) }))}>
            Nueva partida con los mismos
          </button>
          <button className="btn" onClick={() => { saveGame(null); navigate('/historial'); }}>Ver historial</button>
          <button className="btn ghost" onClick={startFromScratch} title="Lista y puntajes nuevos. Los celulares conectados siguen en la sala.">Empezar de cero</button>
        </div>
      </div>
    );
  }

  return <HostPlay ctx={ctx} />;
}
