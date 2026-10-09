import { Component, type ReactNode } from 'react';

/**
 * Segunda defensa: si una vista falla al dibujar, mostramos cómo seguir en
 * vez de una pantalla vacía. La partida del juez está en localStorage, así
 * que recargar la recupera.
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
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>Algo falló en esta pantalla</h2>
          <p className="muted">La partida y los puntajes quedaron guardados. Recargá para seguir.</p>
          <p className="muted small">{this.state.error.message}</p>
          <button className="btn primary block" onClick={() => location.reload()}>Recargar</button>
        </div>
      </div>
    );
  }
}
