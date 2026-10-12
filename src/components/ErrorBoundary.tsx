import { Component, type ReactNode } from 'react';
import { downloadBackup } from './StorageBanner';
import { discardSavedGame } from '../storage/store';

/**
 * Segunda defensa: si una vista falla al dibujar, mostramos cómo seguir en
 * vez de una pantalla vacía. Si recargar no alcanza (B06: un dato guardado
 * que la validación no detectó), se puede apartar sólo la partida guardada,
 * sin tocar listas ni historial.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('En 1 Nota: error de interfaz', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center" role="alert">
        <div className="card" style={{ maxWidth: 480 }}>
          <h2>Algo falló en esta pantalla</h2>
          <p className="muted">Probá recargar. Si vuelve a pasar, podés apartar la partida guardada (se conserva una copia) y empezar una nueva: tus listas e historial no se tocan.</p>
          <p className="muted small">{this.state.error.message}</p>
          <div className="col">
            <button className="btn primary block" onClick={() => location.reload()}>Recargar</button>
            <button className="btn block" onClick={() => { discardSavedGame(); location.reload(); }}>Apartar la partida guardada y seguir</button>
            <button className="btn ghost block" onClick={downloadBackup}>Descargar respaldo para diagnóstico</button>
          </div>
        </div>
      </div>
    );
  }
}
