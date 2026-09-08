// Tipado mínimo del Web Playback SDK de Spotify (se carga desde sdk.scdn.co).
declare namespace Spotify {
  interface PlayerInit {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }
  interface WebPlaybackTrack {
    uri: string;
    id: string | null;
    name: string;
    duration_ms: number;
  }
  interface PlaybackState {
    paused: boolean;
    position: number;
    duration: number;
    timestamp: number;
    track_window: { current_track: WebPlaybackTrack };
  }
  interface Player {
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(event: 'ready' | 'not_ready', cb: (d: { device_id: string }) => void): boolean;
    addListener(event: 'player_state_changed', cb: (s: PlaybackState | null) => void): boolean;
    addListener(event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error', cb: (e: { message: string }) => void): boolean;
    removeListener(event: string): boolean;
    getCurrentState(): Promise<PlaybackState | null>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(ms: number): Promise<void>;
    setVolume(v: number): Promise<void>;
    activateElement(): Promise<void>;
  }
  const Player: new (init: PlayerInit) => Player;
}
interface Window {
  onSpotifyWebPlaybackSDKReady?: () => void;
  Spotify?: typeof Spotify;
}
