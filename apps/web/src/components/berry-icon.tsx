'use client';

import { useId } from 'react';

/**
 * Ícono de marca — dos berries + hoja.
 *
 * Los colores salen de las variables de tema (`--primary`, y un violeta y un
 * verde derivados del mismo gradiente de marca que usa `.brand-gradient`), no
 * de hex sueltos: la versión anterior tenía coral/lavanda hardcodeados y quedó
 * desfasada al cambiar la paleta. Al leerlos del tema, el logo sigue a la marca
 * solo.
 *
 * IDs de gradiente únicos por instancia (`useId`) para poder renderizarlo más
 * de una vez en la misma página sin que choquen los `<defs>`.
 */
export function BerryIcon({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-berry-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary) / 0.85)" />
          <stop offset="100%" stopColor="hsl(var(--primary))" />
        </linearGradient>
        <linearGradient id={`${id}-berry-b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(300 65% 62%)" />
          <stop offset="100%" stopColor="hsl(280 70% 52%)" />
        </linearGradient>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(152 55% 58%)" />
          <stop offset="100%" stopColor="hsl(160 60% 42%)" />
        </linearGradient>
      </defs>

      <path
        d="M16.5 15C15.7 11.3 15 8.2 18 5.3"
        fill="none"
        stroke="hsl(152 30% 45%)"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M20 15.8C19.2 12.2 18.4 8.8 18 5.3"
        fill="none"
        stroke="hsl(152 30% 45%)"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path d="M18 5.3C19.8 3.3 23 3.4 24.6 5.5C22.9 7.7 19.5 8.1 18 5.3Z" fill={`url(#${id}-leaf)`} />

      <circle cx="13" cy="21.3" r="7" fill={`url(#${id}-berry-a)`} />
      <circle cx="20.5" cy="22" r="6.4" fill={`url(#${id}-berry-b)`} />
      <ellipse cx="10.6" cy="18.5" rx="1.9" ry="1.3" fill="#FFFFFF" opacity="0.3" />
      <ellipse cx="18.4" cy="19.4" rx="1.5" ry="1" fill="#FFFFFF" opacity="0.25" />
    </svg>
  );
}
