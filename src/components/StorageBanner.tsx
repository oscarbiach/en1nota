import { useEffect, useState } from 'react';
import { exportBackup, freeSpace, onStorageIssue, type StorageIssue } from '../storage/store';

/** La vista del juez registra acá lo que tiene en memoria (la partida en curso). */
let memorySource: () => Record<string, unknown> = () => ({});
export function setMemoryBackup(fn: () => Record<string, unknown>) {
  memorySource = fn;
}

/** Descarga un respaldo JSON (datos guardados + lo que está en memoria, sin credenciales). */
export function downloadBackup() {
  const blob = new Blob([exportBackup(memorySource())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `en1nota-respaldo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/**
 * Avisos de almacenamiento (B04/B06): guardados que fallaron y datos que se
 * recuperaron o apartaron. Siempre ofrece una acción útil.
 */
export function StorageBanner() {
  const [issue, setIssue] = useState<StorageIssue>();
  const [freed, setFreed] = useState<string>();
  useEffect(() => onStorageIssue(setIssue), []);
  if (!issue) return null;

  const free = () => {
    const n = freeSpace();
    if (n > 0) { setFreed(`Se borraron ${n} copias de diagnóstico.`); return; }
    if (confirm('No hay copias de diagnóstico para borrar. ¿Borrar el historial de partidas de este dispositivo? (Descargá un respaldo antes si lo querés conservar.)')) {
      setFreed(freeSpace({ history: true }) ? 'Se borró el historial.' : 'No había nada más para borrar.');
    }
  };

  return (
    <div className="storage-banner" role="alert" data-testid="storage-banner">
      {issue.kind === 'write-failed' ? (
        <div>
          <b>No se pudo guardar {issue.what} en este dispositivo{issue.quota ? ' (almacenamiento lleno)' : ''}.</b>
          <div className="small">Lo que ves sigue en pantalla, pero si recargás se puede perder. Descargá un respaldo o liberá espacio.</div>
        </div>
      ) : (
        <div>
          <b>Se recuperaron datos guardados.</b>
          <div className="small">{issue.detail}</div>
        </div>
      )}
      {freed && <div className="small">{freed}</div>}
      <div className="row">
        <button className="btn sm primary" onClick={downloadBackup}>Descargar respaldo</button>
        {issue.kind === 'write-failed' && <button className="btn sm" onClick={free}>Liberar espacio</button>}
        <button className="btn sm ghost" onClick={() => { setIssue(undefined); setFreed(undefined); }}>Cerrar</button>
      </div>
    </div>
  );
}
