'use client';

import type { CSSProperties } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { formatMoney, isValidHexColor } from '@chillberry/domain';
import { cartaThemeStyle, resolveCartaTheme, type CartaTheme } from '@/lib/carta-theme';

/** Producto mínimo para el preview — real (de la carta pública) o de muestra. */
export type PreviewProduct = {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  imageUrl: string | null;
};

/** Imagen del producto, o placeholder con ícono (mismo criterio que `/r/[slug]`). */
function ProductImage({ url, className }: { url: string | null; className: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${className} shrink-0 rounded-md object-cover`} />;
  }
  return (
    <div className={`${className} flex shrink-0 items-center justify-center rounded-md bg-muted`}>
      <UtensilsCrossed className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />
    </div>
  );
}

/**
 * Preview en vivo de la carta pública de una sucursal, dentro de un marco tipo
 * teléfono. Espeja cómo renderiza `/r/[slug]`: aplica los mismos tokens
 * (`--primary`/`--primary-foreground`/`--carta-accent`/`--carta-font`) que
 * derivan del tema, así el botón "Agregar" toma el color principal, el texto
 * su tipografía, y la portada su estilo. Es 100% presentacional (los "botones"
 * son spans sin interacción) para no arrastrar semántica de foco al mock.
 */
export function CartaDesignPreview({
  theme,
  brandColor,
  branchName,
  coverImageUrl,
  restaurantLogoUrl,
  countryCode,
  products,
}: {
  theme: CartaTheme;
  brandColor: string | null;
  branchName: string;
  coverImageUrl: string | null;
  restaurantLogoUrl: string | null;
  countryCode: string;
  products: PreviewProduct[];
}) {
  const resolved = resolveCartaTheme(theme);

  const rootStyle: CSSProperties = {
    ...cartaThemeStyle(theme, brandColor),
    fontFamily: 'var(--carta-font)',
  };

  const logo = theme.logoUrl?.trim() || restaurantLogoUrl || null;
  const cover = coverImageUrl?.trim() || null;
  const accentOn = !!theme.accentColor && isValidHexColor(theme.accentColor);
  const accentStyle: CSSProperties | undefined = accentOn ? { color: 'hsl(var(--carta-accent))' } : undefined;

  // Portada según headerStyle: imagen (foto de portada, con fallback a degradé
  // si no hay foto), solido (color principal, texto derivado por contraste), o
  // degradé de marca (default). imagen/gradiente usan texto blanco sobre overlay
  // oscuro, igual que la carta real.
  const useImage = resolved.headerStyle === 'imagen' && !!cover;
  const useSolid = resolved.headerStyle === 'solido';
  const onDark = !useSolid; // solido usa --primary-foreground; el resto, blanco
  const headerBgStyle: CSSProperties | undefined = useImage
    ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : undefined;
  const headerClass = [
    'relative flex h-32 w-full flex-col items-center justify-end px-3 pb-3',
    useImage ? '' : useSolid ? 'bg-primary' : 'brand-gradient',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="mx-auto w-full max-w-[20rem]">
      <div
        className="overflow-hidden rounded-[2rem] border-[6px] border-foreground/10 bg-background shadow-lg"
        style={rootStyle}
      >
        {/* Portada */}
        <div className={headerClass} style={headerBgStyle}>
          {onDark && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/45 to-black/20" />
          )}
          <div className="relative z-10 flex flex-col items-center">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt=""
                className="mb-2 h-12 w-12 rounded-xl border-2 border-white/90 object-cover shadow"
              />
            )}
            <span
              className={`text-center text-lg font-semibold ${onDark ? 'text-white drop-shadow' : 'text-primary-foreground'}`}
            >
              {branchName || 'Tu sucursal'}
            </span>
          </div>
        </div>

        {/* Cuerpo de la carta */}
        <div className="max-h-[24rem] overflow-y-auto p-3">
          <h3 className="text-sm font-semibold text-foreground" style={accentStyle}>
            Nuestros platos
          </h3>
          {accentOn && (
            <span
              className="mb-2 mt-1 block h-1 w-10 rounded-full"
              style={{ backgroundColor: 'hsl(var(--carta-accent))' }}
            />
          )}

          {resolved.layout === 'grilla' ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {products.map((p) => (
                <div key={p.id} className="card-dense p-2">
                  {resolved.showImages && <ProductImage url={p.imageUrl} className="h-20 w-full" />}
                  <p className={`${resolved.showImages ? 'mt-1' : ''} truncate text-sm font-semibold text-foreground`}>
                    {p.name}
                  </p>
                  {resolved.showDescriptions && p.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="tabular text-sm font-semibold text-foreground">
                      {formatMoney(p.price, countryCode)}
                    </span>
                    <span className="btn btn-primary btn-sm pointer-events-none px-2" aria-hidden="true">
                      +
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {products.map((p) => (
                <div key={p.id} className="card-dense flex items-center gap-2 p-2">
                  {resolved.showImages && <ProductImage url={p.imageUrl} className="h-14 w-14" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                    {resolved.showDescriptions && p.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="tabular text-sm font-semibold text-foreground">
                        {formatMoney(p.price, countryCode)}
                      </span>
                      <span className="btn btn-primary btn-sm pointer-events-none" aria-hidden="true">
                        Agregar
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
