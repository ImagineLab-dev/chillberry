'use client';

import { useEffect, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

/**
 * Foto de un plato en la carta pública (por slug o por QR) con caída elegante.
 * Si no hay URL —o si la URL existe pero falla al cargar (404, host de imágenes
 * caído)— muestra el MISMO placeholder que un ítem sin foto, en vez de dejar el
 * ícono de imagen rota del navegador y una tarjeta alta y vacía.
 *
 * `imgClassName` estiliza la <img>; `boxClassName` da el tamaño del placeholder
 * (los dos comparten alto/ancho para que la card no salte según haya foto o no).
 */
export function MenuItemImage({
  src,
  alt,
  imgClassName,
  boxClassName,
}: {
  src: string | null;
  alt: string;
  imgClassName: string;
  boxClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  // Si cambia la URL (el dueño corrige la foto y la carta se re-fetchea), se
  // reintenta: sin esto quedaba pegado en el placeholder tras un error viejo.
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className={`flex shrink-0 items-center justify-center rounded-lg bg-muted ${boxClassName}`}>
        <UtensilsCrossed className="h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={imgClassName}
      onError={() => setFailed(true)}
    />
  );
}
