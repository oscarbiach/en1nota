import { useState } from 'react';
import { navigate } from '../App';
import { loadPlayerName, savePlayerName } from '../storage/store';
import { unlockAudio } from '../audio/sfx';
import { SoundWave } from '../components/SoundWave';

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
    <div className="page home">
      <header className="home-nav"><a className="wordmark" href="#/">en<span>1</span>nota<span className="brand-dot">●</span></a><button className="btn sm ghost" onClick={() => navigate('/historial')}>Tus partidas ↗</button></header>
      <section className="hero">
        <div><span className="eyebrow"><span className="live-dot" /> EL JUEGO DE LOS QUE LA SABEN</span>
          <h1>Tu oído.<br />Tu momento.<br /><em>Una nota.</em></h1>
          <p>Ese tema que reconocés al instante.<br />Escuchá, tocá y demostrá cuánto sabés.</p>
          <a className="hero-link" href="#modos" onClick={(e) => { e.preventDefault(); document.getElementById('modos')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>Elegí cómo jugar ↓</a>
        </div>
        <div className="record-scene" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="record"><div className="record-label"><span>EN</span><b>1</b><span>NOTA</span></div></div><span className="record-tag">DALE PLAY A LA JUNTADA</span><SoundWave active /></div>
      </section>
      <section id="modos" className="home-modes" aria-label="Elegí cómo jugar">
        {([
          ['solo', '01', 'Solitario', 'Vos, 30 segundos y una canción. Escribí la respuesta o jugá a tu ritmo.'],
          ['duel', '02', '1 contra 1', 'Un mano a mano. Dos pulsadores y ningún juez extra.'],
          ['party', '03', 'La juntada', 'Hasta 8 jugadores. Si el primero falla, el siguiente tiene su oportunidad.']
        ] as const).map(([mode, n, title, desc]) => <button key={mode} className={`mode-card mode-${mode}`} onClick={() => { unlockAudio(); navigate(`/juez?modo=${mode}`); }}><span className="mode-number">{n}</span><span className="mode-arrow">↗</span><h2>{title}</h2><p>{desc}</p><span className="mode-action">Preparar partida →</span></button>)}
      </section>

      <div className="grid2 mt join-grid">
        <div className="card">
          <span className="eyebrow">¿YA ARMARON UNA SALA?</span><h2>Entrá a la ronda.</h2>
          <div className="field">
            <label>Tu nombre</label>
            <input aria-label="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Flor" maxLength={24} />
          </div>
          <div className="field">
            <label htmlFor="home-room">Código de la sala</label>
            <input id="home-room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ABCD" maxLength={4} style={{ textTransform: 'uppercase', letterSpacing: '.3em', fontWeight: 800 }} onKeyDown={(e) => e.key === 'Enter' && join()} />
          </div>
          <button className="btn primary block xl" disabled={code.length !== 4 || !name.trim()} onClick={join}>Entrar con mi celu</button>
        </div>

        <div className="card">
          <span className="eyebrow">ASÍ DE SIMPLE</span><h2>Escuchá. Arriesgá. Festejá.</h2>
          <ol className="how-to"><li><span>01</span><div><b>Un fragmento, nada más</b><p>Si no sale, probá una pasada más larga.</p></div></li><li><span>02</span><div><b>Tu toque guarda tu lugar</b><p>Si alguien falla, sigue el próximo de la cola.</p></div></li><li><span>03</span><div><b>El acierto se celebra</b><p>Decí el nombre, cantá o tarareá. En solitario también podés escribirlo.</p></div></li></ol>
          <button className="btn block" onClick={() => { unlockAudio(); navigate('/juez'); }}>Abrir panel del juez / retomar</button>
        </div>
      </div>

      <div className="card soft mt">
        <div className="row between">
          <div>
            <b>Pantalla para la tele</b>
            <div className="muted small">Muestra puntajes, quién tocó y la canción al revelarla. Nunca muestra el título antes de tiempo.</div>
          </div>
          <div className="row">
            <input aria-label="Código para la TV" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="ABCD" maxLength={4} style={{ width: 110, textTransform: 'uppercase', letterSpacing: '.3em', fontWeight: 800 }} />
            <button className="btn" disabled={code.length !== 4} onClick={() => { unlockAudio(); navigate(`/tv?sala=${code}`); }}>Abrir TV</button>
          </div>
        </div>
      </div>

      <p className="muted small mt">Versión publicada: {__BUILD__}</p>
      <p className="muted small mt">
        Reglas: el que toca primero tiene que decir el nombre o cantar la canción (tarareando también vale). Si falla o se queda en blanco, resta puntos y queda bloqueado en ese tema.
      </p>
    </div>
  );
}
