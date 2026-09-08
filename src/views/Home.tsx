import { useState } from 'react';
import { navigate } from '../App';
import { loadPlayerName, savePlayerName } from '../storage/store';
import { unlockAudio } from '../audio/sfx';

export function Home() {
  const [room, setRoom] = useState('');
  const [name, setName] = useState(loadPlayerName());
  const code = room.trim().toUpperCase();

  const join = () => {
    if (code.length !== 4) return;
    savePlayerName(name.trim());
    unlockAudio();
    navigate(`/jugar?sala=${code}`);
  };

  return (
    <div className="page">
      <div className="center" style={{ minHeight: 'auto', paddingBottom: 8 }}>
        <div>
          <div className="huge" style={{ color: 'var(--accent)' }}>En 1 Nota</div>
          <p className="muted">Escuchá un pedacito, tocá primero, decí la canción.</p>
        </div>
      </div>

      <div className="grid2 mt">
        <div className="card">
          <h2>Quiero jugar</h2>
          <div className="field">
            <label>Tu nombre</label>
            <input aria-label="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Flor" maxLength={24} />
          </div>
          <div className="field">
            <label>Código de la sala (lo muestra el juez)</label>
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ABCD" maxLength={4} style={{ textTransform: 'uppercase', letterSpacing: '.3em', fontWeight: 800 }} onKeyDown={(e) => e.key === 'Enter' && join()} />
          </div>
          <button className="btn primary block xl" disabled={code.length !== 4 || !name.trim()} onClick={join}>Entrar con mi celu</button>
        </div>

        <div className="card">
          <h2>Soy el juez</h2>
          <p className="muted">Manejo la música desde mi Spotify, veo quién tocó primero y doy los puntos. También sirve para jugar en un solo dispositivo (modo mesa).</p>
          <button className="btn block xl" onClick={() => { unlockAudio(); navigate('/juez'); }}>Abrir panel del juez</button>
          <div className="row mt">
            <button className="btn ghost grow" onClick={() => navigate('/historial')}>Historial y estadísticas</button>
          </div>
        </div>
      </div>

      <div className="card soft mt">
        <div className="row between">
          <div>
            <b>Pantalla para la tele</b>
            <div className="muted small">Muestra puntajes, quién tocó y la canción al revelarla. Nunca muestra el título antes de tiempo.</div>
          </div>
          <div className="row">
            <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ABCD" maxLength={4} style={{ width: 110, textTransform: 'uppercase', letterSpacing: '.3em', fontWeight: 800 }} />
            <button className="btn" disabled={code.length !== 4} onClick={() => { unlockAudio(); navigate(`/tv?sala=${code}`); }}>Abrir TV</button>
          </div>
        </div>
      </div>

      <p className="muted small mt" style={{ opacity: .6 }}>Versión publicada: {__BUILD__}</p>
      <p className="muted small mt">
        Reglas: el que toca primero tiene que decir el nombre exacto o cantar la letra. Si falla, se queda en blanco o tararea, resta puntos y queda bloqueado en ese tema.
      </p>
    </div>
  );
}
