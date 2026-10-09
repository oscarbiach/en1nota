// Operaciones de reproducción cancelables. Contrato común a todos los
// reproductores: una operación SIEMPRE termina (resuelve o rechaza), y
// empezar una nueva o llamar stop() cancela la anterior. Así nadie queda
// esperando una promesa que nunca se completa (auditoría A01).

export type SnippetResult = 'done' | 'cancelled';

export class Cancelled extends Error {
  constructor() {
    super('cancelado');
  }
}

export class Op {
  cancelled = false;
  private hooks = new Set<() => void>();

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    const hs = [...this.hooks];
    this.hooks.clear();
    hs.forEach((h) => h());
  }

  /** Espera `p`; si la operación se cancela antes, rechaza con Cancelled. */
  wait<T>(p: Promise<T>): Promise<T> {
    if (this.cancelled) {
      p.catch(() => {}); // su resultado ya no le importa a nadie
      return Promise.reject(new Cancelled());
    }
    return new Promise<T>((resolve, reject) => {
      const onCancel = () => reject(new Cancelled());
      this.hooks.add(onCancel);
      p.then(
        (v) => { this.hooks.delete(onCancel); if (!this.cancelled) resolve(v); },
        (e) => { this.hooks.delete(onCancel); if (!this.cancelled) reject(e); }
      );
    });
  }

  /** Espera `ms`; al cancelar, libera el timer y rechaza con Cancelled. */
  sleep(ms: number): Promise<void> {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { this.hooks.delete(onCancel); resolve(); }, ms);
      const onCancel = () => { clearTimeout(t); reject(new Cancelled()); };
      this.hooks.add(onCancel);
    });
  }
}

/** Una operación activa por reproductor: begin() cancela la anterior. */
export class Runner {
  private current?: Op;

  begin(): Op {
    this.current?.cancel();
    this.current = new Op();
    return this.current;
  }

  cancel() {
    this.current?.cancel();
    this.current = undefined;
  }
}

/** Corre `fn`; una cancelación es un resultado normal, no un error. */
export async function runSnippet(fn: () => Promise<void>): Promise<SnippetResult> {
  try {
    await fn();
    return 'done';
  } catch (e) {
    if (e instanceof Cancelled) return 'cancelled';
    throw e;
  }
}
