import { useEffect, useState } from 'react';
import { Home } from './views/Home';
import { Host } from './views/Host';
import { PlayerView } from './views/Player';
import { ScreenView } from './views/Screen';
import { HistoryView } from './views/History';
import { completeLoginIfNeeded } from './spotify/auth';

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parseHash(): Route {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, q = ''] = h.split('?');
  return { path, params: new URLSearchParams(q) };
}

export function navigate(to: string) {
  location.hash = to;
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [authError, setAuthError] = useState<string>();
  const [booting, setBooting] = useState(() => location.search.includes('code=') || location.search.includes('error='));

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!booting) return;
    completeLoginIfNeeded()
      .then((back) => { if (back) { location.hash = back; setRoute(parseHash()); } })
      .catch((e: Error) => setAuthError(e.message))
      .finally(() => setBooting(false));
  }, [booting]);

  if (booting) return <div className="center muted">Conectando con Spotify…</div>;

  const { path, params } = route;
  let view;
  if (path.startsWith('/juez')) view = <Host authError={authError} />;
  else if (path.startsWith('/jugar')) view = <PlayerView room={params.get('sala') ?? ''} />;
  else if (path.startsWith('/tv')) view = <ScreenView room={params.get('sala') ?? ''} />;
  else if (path.startsWith('/historial')) view = <HistoryView />;
  else view = <Home />;
  return view;
}
