import { useRef } from 'react';

/**
 * Pulsador que responde al instante al tocar (pointerdown) y también a
 * Enter / Espacio / tecnologías de asistencia, que sólo generan `click`.
 * Un click que llega justo después de un toque es el mismo gesto y se
 * ignora, así cada activación envía exactamente una pulsación.
 */
export function usePress(fn: () => void) {
  const lastPointer = useRef(0);
  return {
    onPointerDown: () => {
      lastPointer.current = Date.now();
      fn();
    },
    onClick: () => {
      if (Date.now() - lastPointer.current > 1000) fn();
    }
  };
}
