'use client';

import { useEffect, useRef } from 'react';

/**
 * Comportamiento estándar de un modal: al abrir, el foco entra al diálogo y el
 * scroll del fondo se bloquea; Tab queda ATRAPADO adentro (sin esto se llegaba
 * con el teclado al selector de sucursal con el modal abierto); al cerrar, el
 * foco vuelve al disparador. Escape lo maneja cada pantalla, porque suele
 * depender de si hay un submit en vuelo.
 *
 * Uso: `const ref = useModalBehavior(open)` y `<div ref={ref} role="dialog">`.
 */
export function useModalBehavior(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previo = document.activeElement as HTMLElement | null;
    const previoOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

    focusables()[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previoOverflow;
      previo?.focus?.();
    };
  }, [open]);

  return ref;
}
