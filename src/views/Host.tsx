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
import { navigate } from '../App';

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
  loggedIn: boolean;
  setLoggedIn: (v: boolean) => void;
}

export function Host({ authError }: { authError?: string }) {
  const [game, setGame] = useState<GameState>(() => {
    const saved = loadGame();
    if (saved) return saved;
    return E.newGame({ settings: { ...E.newGame().settings, ...loadSettings() } });
  });
  const gameRef = useRef(game);
  gameRef.current = game;

  const [room, setRoom] = useState<string>();
  const [online, setOnline] = useState(false);
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(new Map());
  const [player, setPlayerState] = useState<SnippetPlayer | null>(null);
  const [playerStatus, setPlayerStatus] = useState('Sin reproductor');
  const [localSfx, setLocalSfx] = useState(true);
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const buzzTimer = useRef<number>(undefined);
  const connRef = useRef<HostConnection>(null);

  const update = useCallback((fn: (g: GameState) => GameState) => {
    setGame((g) => fn(g));
  }, []);

  // --- sala ---
  const conn = useMemo(() => {
    const c = new HostConnection({
      onRoom: setRoom,
      onOnline: setOnline,
      onPeer: (p) => {
        setPeers((m) => new Map(m).set(p.pid, p));
        setGame((g) => (g.players.some((x) => x.id === p.pid) ? E.setConnected(g, p.pid, p.connected) : g));
      },
      onHello: (pid, role, name) => {
        setPeers((m) => new Map(m).set(pid, { pid, role, name, connected: true }));
        if (role !== 'player') return;
        setGame((g) => {
          const existing = g.players.find((x) => x.id === pid);
          let next = existing ? E.setConnected(g, pid, true) : g.phase === 'lobby' && g.players.length < 8 ? E.addPlayer(g, name, pid) : g;
          const pl = next.players.find((x) => x.id === pid);
          if (pl) c.sendTo(pid, { k: 'welcome', playerId: pid, name: pl.name, color: pl.color });
          else c.sendTo(pid, { k: 'rejected', reason: g.phase === 'lobby' ? 'La sala está llena' : 'La partida ya empezó' });
          return next;
        });
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

  const ctx: HostCtx = {
    game, update, room, online, peers, conn, player, playerStatus, setPlayer, setPlayerStatus,
    localSfx, setLocalSfx, sfx: emitSfx, buzz: onBuzz, loggedIn, setLoggedIn
  };

  const setTracks = (tracks: Track[]) => update((g) => ({ ...g, tracks }));

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
          <button className="btn ghost" onClick={() => { update(() => E.newGame({ settings: game.settings })); }}>Empezar de cero</button>
        </div>
      </div>
    );
  }

  return <HostPlay ctx={ctx} />;
}
