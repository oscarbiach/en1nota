import { useEffect, useRef, useState } from 'react';
import type { HostCtx } from './Host';
import type { Track } from '../game/types';
import { myPlaylists, parsePlaylistId, playlistTracks, searchTracks, type PlaylistSummary } from '../spotify/api';
import { deletePlaylist, loadPlaylists, savePlaylist, type SavedPlaylist } from '../storage/store';
import { newId } from '../game/engine';
import { mmss, shuffle } from '../util/format';

export function PlaylistEditor({ ctx, tracks, setTracks }: { ctx: HostCtx; tracks: Track[]; setTracks: (t: Track[]) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<PlaylistSummary[]>([]);
  const [importUrl, setImportUrl] = useState('');
  const [saved, setSaved] = useState<SavedPlaylist[]>(loadPlaylists);
  const [saveName, setSaveName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const searchTimer = useRef<number>(undefined);
  const [manualName, setManualName] = useState('');
  const [manualArtist, setManualArtist] = useState('');

  useEffect(() => {
    if (!ctx.loggedIn || q.trim().length < 2) { setResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      searchTracks(q.trim()).then(setResults).catch((e: Error) => setErr(e.message));
    }, 350);
  }, [q, ctx.loggedIn]);

  const run = async (fn: () => Promise<void>) => {
    setErr(undefined); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const add = (t: Track) => { if (!tracks.some((x) => x.uri === t.uri)) setTracks([...tracks, t]); };
  const addManual = () => {
    if (!manualName.trim()) return;
    const id = newId();
    add({ id, uri: `manual:${id}`, name: manualName.trim(), artists: manualArtist.trim(), album: '', durationMs: 240000, startMs: 0 });
    setManualName(''); setManualArtist('');
  };
  const remove = (i: number) => { setTracks(tracks.filter((_, j) => j !== i)); setEditing(null); };
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= tracks.length) return;
    const a = [...tracks]; [a[i], a[j]] = [a[j], a[i]]; setTracks(a); setEditing(j);
  };
  const setStart = (i: number, ms: number) => setTracks(tracks.map((t, j) => (j === i ? { ...t, startMs: Math.max(0, Math.min(t.durationMs - 1000, ms)) } : t)));

  const importPlaylist = (id: string) => run(async () => {
    const ts = await playlistTracks(id);
    const seen = new Set(tracks.map((t) => t.uri));
    setTracks([...tracks, ...ts.filter((t) => !seen.has(t.uri))]);
    setImportUrl('');
  });

  const preview = (t: Track, len = 1500) => run(async () => {
    if (!ctx.player?.ready) throw new Error('Activá el reproductor en la pestaña Spotify');
    await ctx.player.playSnippet(t.uri, t.startMs, len);
  });

  return (
    <div className="grid2">
      <div className="col">
        <div className="card">
          <h2>Buscar en Spotify</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canción o artista…" disabled={!ctx.loggedIn} />
          {results.length > 0 && (
            <ul className="list mt">
              {results.map((t) => (
                <li key={t.uri} className="item">
                  {t.image && <img src={t.image} alt="" />}
                  <div className="t"><b>{t.name}</b><span>{t.artists}</span></div>
                  <button className="btn sm" disabled={tracks.some((x) => x.uri === t.uri)} onClick={() => add(t)}>＋</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Agregar a mano</h2>
          <p className="muted small">Para el modo sin reproductor, o para un tema que no está en Spotify.</p>
          <div className="row">
            <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Canción" className="grow" />
            <input value={manualArtist} onChange={(e) => setManualArtist(e.target.value)} placeholder="Artista" className="grow" onKeyDown={(e) => e.key === 'Enter' && addManual()} />
            <button className="btn" disabled={!manualName.trim()} onClick={addManual}>＋</button>
          </div>
        </div>

        <div className="card">
          <h2>Importar playlist de Spotify</h2>
          <p className="muted small">Sirven las playlists creadas por vos o por otros usuarios. Las oficiales de Spotify no se pueden leer desde apps nuevas: copiá sus temas a una lista tuya.</p>
          <div className="row">
            <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="Pegá el link de una playlist" className="grow" disabled={!ctx.loggedIn} />
            <button className="btn" disabled={busy || !parsePlaylistId(importUrl)} onClick={() => importPlaylist(parsePlaylistId(importUrl)!)}>Importar</button>
          </div>
          <div className="row mt">
            <button className="btn sm" disabled={!ctx.loggedIn || busy} onClick={() => run(async () => setMine(await myPlaylists()))}>Ver mis playlists</button>
          </div>
          {mine.length > 0 && (
            <ul className="list mt" style={{ maxHeight: 260, overflow: 'auto' }}>
              {mine.map((p) => (
                <li key={p.id} className="item">
                  {p.image && <img src={p.image} alt="" />}
                  <div className="t"><b>{p.name}</b><span>{p.total} temas</span></div>
                  <button className="btn sm" disabled={busy} onClick={() => importPlaylist(p.id)}>Importar</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>Listas guardadas en este dispositivo</h2>
          <div className="row mb">
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Nombre para guardar la lista actual" className="grow" />
            <button className="btn sm" disabled={!saveName.trim() || tracks.length === 0} onClick={() => { const p = { id: newId(), name: saveName.trim(), tracks, updatedAt: Date.now() }; savePlaylist(p); setSaved(loadPlaylists()); setSaveName(''); }}>Guardar</button>
          </div>
          {saved.length === 0 && <p className="muted small">Todavía no guardaste ninguna.</p>}
          <ul className="list">
            {saved.map((p) => (
              <li key={p.id} className="item">
                <div className="t"><b>{p.name}</b><span>{p.tracks.length} temas</span></div>
                <button className="btn sm" onClick={() => setTracks(p.tracks)}>Cargar</button>
                <button className="btn sm ghost" onClick={() => { deletePlaylist(p.id); setSaved(loadPlaylists()); }}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="row between mb">
          <h2 style={{ margin: 0 }}>Lista de la partida ({tracks.length})</h2>
          <div className="row">
            <button className="btn sm" disabled={tracks.length < 2} onClick={() => setTracks(shuffle(tracks))}>Mezclar</button>
            <button className="btn sm ghost" disabled={tracks.length === 0} onClick={() => { if (confirm('¿Vaciar la lista?')) setTracks([]); }}>Vaciar</button>
          </div>
        </div>
        {err && <div className="error small mb">{err}</div>}
        {tracks.length === 0 && <p className="muted">Buscá canciones o importá una playlist. Los jugadores nunca ven esta lista.</p>}
        <ul className="list">
          {tracks.map((t, i) => (
            <li key={t.uri} className={`item ${editing === i ? 'current' : ''}`} style={{ flexWrap: 'wrap' }}>
              <span className="muted small" style={{ width: 24 }}>{i + 1}</span>
              {t.image && <img src={t.image} alt="" />}
              <div className="t" onClick={() => setEditing(editing === i ? null : i)} style={{ cursor: 'pointer' }}>
                <b>{t.name}</b><span>{t.artists} · arranca en {mmss(t.startMs)}</span>
              </div>
              <button className="btn sm" title="Escuchar 1,5 s desde el inicio marcado" disabled={busy} onClick={() => preview(t)}>▶</button>
              <button className="btn sm ghost" onClick={() => setEditing(editing === i ? null : i)}>⚙</button>
              {editing === i && (
                <div style={{ width: '100%' }} className="col">
                  <label>Punto de inicio del fragmento: {mmss(t.startMs)} / {mmss(t.durationMs)}</label>
                  <input type="range" min={0} max={Math.max(0, t.durationMs - 1000)} step={100} value={t.startMs} onChange={(e) => setStart(i, Number(e.target.value))} />
                  <div className="row">
                    <button className="btn sm" onClick={() => setStart(i, t.startMs - 1000)}>−1 s</button>
                    <button className="btn sm" onClick={() => setStart(i, t.startMs - 100)}>−0,1</button>
                    <button className="btn sm" onClick={() => setStart(i, t.startMs + 100)}>+0,1</button>
                    <button className="btn sm" onClick={() => setStart(i, t.startMs + 1000)}>+1 s</button>
                    <button className="btn sm" onClick={() => setStart(i, 0)}>Al inicio</button>
                    <span className="grow" />
                    <button className="btn sm" disabled={busy} onClick={() => preview(t, 400)}>▶ 0,4 s</button>
                    <button className="btn sm" disabled={busy} onClick={() => preview(t, 3000)}>▶ 3 s</button>
                    <button className="btn sm" onClick={() => ctx.player?.stop()}>■</button>
                  </div>
                  <div className="row">
                    <button className="btn sm" onClick={() => move(i, -1)} disabled={i === 0}>↑ Subir</button>
                    <button className="btn sm" onClick={() => move(i, 1)} disabled={i === tracks.length - 1}>↓ Bajar</button>
                    <span className="grow" />
                    <button className="btn sm bad" onClick={() => remove(i)}>Quitar</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
