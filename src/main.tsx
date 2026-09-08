import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

// Actualizaciones: revisa cada minuto y avisa con un cartel; el juez decide cuándo recargar.
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => { void reg.update(); }, 60_000);
  },
  onNeedRefresh() {
    if (document.getElementById('update-banner')) return;
    const el = document.createElement('div');
    el.id = 'update-banner';
    el.className = 'update-banner';
    el.innerHTML = '<span>Hay una versión nueva de En 1 Nota.</span>';
    const btn = document.createElement('button');
    btn.className = 'btn sm primary';
    btn.textContent = 'Recargar';
    btn.onclick = () => { void updateSW(true); };
    el.appendChild(btn);
    document.body.appendChild(el);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
