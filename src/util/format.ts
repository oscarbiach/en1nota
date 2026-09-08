export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function secs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)} s` : `${ms} ms`;
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function fecha(ts: number): string {
  return new Date(ts).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
