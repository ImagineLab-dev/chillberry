import type { CSSProperties } from 'react';
import { brandTokens, isValidHexColor } from '@chillberry/domain';

/** Diseño visual de la carta de una sucursal (espeja `CartaThemeDto` del API). */
export type CartaTheme = {
  primaryColor?: string;
  accentColor?: string;
  font?: CartaFont;
  layout?: CartaLayout;
  showImages?: boolean;
  showDescriptions?: boolean;
  headerStyle?: CartaHeaderStyle;
  logoUrl?: string;
};

export type CartaFont = 'moderna' | 'clasica' | 'redondeada' | 'elegante' | 'condensada';
export type CartaLayout = 'lista' | 'grilla';
export type CartaHeaderStyle = 'gradiente' | 'imagen' | 'solido';

/**
 * Cada "letra" → una familia real. Los stacks tienen fallback web-safe, así que
 * se ven bien aunque no se cargue la fuente de Google; el layout público puede
 * cargar Playfair/Oswald/Nunito para que queden exactas.
 */
export const CARTA_FONTS: Record<CartaFont, { label: string; stack: string }> = {
  moderna: { label: 'Moderna', stack: "var(--font-body), 'Plus Jakarta Sans', system-ui, sans-serif" },
  clasica: { label: 'Clásica', stack: "Georgia, 'Times New Roman', serif" },
  redondeada: { label: 'Redondeada', stack: "'Nunito', 'Trebuchet MS', system-ui, sans-serif" },
  elegante: { label: 'Elegante', stack: "'Playfair Display', Georgia, serif" },
  condensada: { label: 'Condensada', stack: "'Oswald', 'Arial Narrow', sans-serif" },
};

export const CARTA_LAYOUTS: Record<CartaLayout, string> = {
  lista: 'Lista',
  grilla: 'Grilla',
};

export const CARTA_HEADER_STYLES: Record<CartaHeaderStyle, string> = {
  gradiente: 'Degradé de color',
  imagen: 'Foto de portada',
  solido: 'Color sólido',
};

/** Valores por defecto cuando la sucursal no configuró nada. */
export const DEFAULT_CARTA_THEME: Required<
  Pick<CartaTheme, 'font' | 'layout' | 'showImages' | 'showDescriptions' | 'headerStyle'>
> = {
  font: 'moderna',
  layout: 'lista',
  showImages: true,
  showDescriptions: true,
  headerStyle: 'gradiente',
};

/** Combina tema + defaults en un objeto siempre completo, cómodo para renderizar. */
export function resolveCartaTheme(theme: CartaTheme | null | undefined): Required<
  Pick<CartaTheme, 'font' | 'layout' | 'showImages' | 'showDescriptions' | 'headerStyle'>
> & Pick<CartaTheme, 'primaryColor' | 'accentColor' | 'logoUrl'> {
  const t = theme ?? {};
  return {
    font: t.font ?? DEFAULT_CARTA_THEME.font,
    layout: t.layout ?? DEFAULT_CARTA_THEME.layout,
    showImages: t.showImages ?? DEFAULT_CARTA_THEME.showImages,
    showDescriptions: t.showDescriptions ?? DEFAULT_CARTA_THEME.showDescriptions,
    headerStyle: t.headerStyle ?? DEFAULT_CARTA_THEME.headerStyle,
    primaryColor: t.primaryColor,
    accentColor: t.accentColor,
    logoUrl: t.logoUrl,
  };
}

/**
 * CSS vars a poner en el root de la carta: `--primary`/`--primary-foreground`
 * (derivadas del color de la sucursal o, si no hay, del brandColor del tenant),
 * `--carta-accent`, y `--carta-font`. El color del texto sobre el primario lo
 * DERIVA `brandTokens` de la luminancia, así ninguna combinación queda ilegible.
 */
export function cartaThemeStyle(
  theme: CartaTheme | null | undefined,
  fallbackBrandColor: string | null,
): CSSProperties {
  const t = theme ?? {};
  const style: Record<string, string> = {};

  const primary = t.primaryColor && isValidHexColor(t.primaryColor)
    ? t.primaryColor
    : fallbackBrandColor && isValidHexColor(fallbackBrandColor)
      ? fallbackBrandColor
      : null;
  if (primary) {
    const tok = brandTokens(primary);
    style['--primary'] = tok.primary;
    style['--primary-foreground'] = tok.primaryForeground;
    // Segundo stop del degradé de marca (portada hero). Por defecto es magenta
    // fijo en globals.css, pensado para el violeta de Chillberry — pero en una
    // carta themeada eso da un hero "color-del-local → magenta", discorde. Se
    // deriva del color del tenant: el accent si lo eligió, o el mismo primario
    // con el tono rotado ~32° (un degradé cohesivo del color del local, no una
    // mezcla con un color ajeno).
    style['--brand-gradient-to'] =
      t.accentColor && isValidHexColor(t.accentColor) ? brandTokens(t.accentColor).primary : rotarTono(tok.primary, 32);
  }
  if (t.accentColor && isValidHexColor(t.accentColor)) {
    style['--carta-accent'] = brandTokens(t.accentColor).primary;
  }
  style['--carta-font'] = CARTA_FONTS[t.font ?? DEFAULT_CARTA_THEME.font].stack;

  return style as CSSProperties;
}

/**
 * Rota el TONO de un triplete HSL `"H S% L%"` (el formato que devuelve
 * `brandTokens`, pensado para envolver con `hsl(var(--x))`) en `deg` grados,
 * manteniendo saturación y luminosidad. Sirve para derivar el segundo stop del
 * degradé de marca del color del tenant. Si el triplete no parsea, devuelve el
 * original — el degradé queda de un solo color, que es un fallback seguro.
 */
function rotarTono(hslTriplet: string, deg: number): string {
  const m = /^\s*([\d.]+)\s+(.+)$/.exec(hslTriplet);
  if (!m) return hslTriplet;
  const h = (((Number(m[1]) + deg) % 360) + 360) % 360;
  return `${h} ${m[2]}`;
}
