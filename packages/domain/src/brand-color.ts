/**
 * Color de marca del tenant para la carta pública.
 *
 * El problema que resuelve este módulo: si dejamos que el tenant elija un color
 * libre y encima le ponemos texto blanco (como hace el tema por defecto), un
 * amarillo o un lima dejan los botones ilegibles — 1.8:1 contra el 4.5:1 que
 * pide WCAG. Y el tenant no tiene forma de saberlo: elige un color que "se ve
 * lindo" en el picker y rompe su propia carta.
 *
 * La solución no es prohibirle colores, es DERIVAR el color del texto según la
 * luminancia real del fondo. Así cualquier color que elija queda legible.
 */

/** Hex de 6 dígitos con `#`. */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa WCAG 2.1 (sRGB). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  // El canal verde pesa 0.7152 y el azul 0.0722: por eso un amarillo es MUCHO
  // más luminoso que un violeta con la misma "lightness" de HSL.
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexToRgb(hexA));
  const b = relativeLuminance(hexToRgb(hexB));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** HSL como triplete sin `hsl()` — el formato que consumen los tokens de Tailwind. */
export function hexToHslTriplet(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = 60 * (((g - b) / d) % 6);
        break;
      case g:
        h = 60 * ((b - r) / d + 2);
        break;
      default:
        h = 60 * ((r - g) / d + 4);
    }
  }
  if (h < 0) h += 360;

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * El texto legible sobre `hex`: blanco o casi-negro, el que dé más contraste.
 *
 * Nunca `#000` puro (se ve duro y anticuado); `#111113` es el mismo near-black
 * tintado que usa el tema oscuro del sistema.
 */
export function readableTextOn(hex: string): string {
  return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, '#111113') ? '#FFFFFF' : '#111113';
}

export type BrandTokens = {
  /** Valor para `--primary` (triplete HSL). */
  primary: string;
  /** Valor para `--primary-foreground` — derivado, garantiza contraste. */
  primaryForeground: string;
  /** Ratio real del par, por si se quiere avisar al tenant. */
  contrast: number;
};

/**
 * Convierte el color elegido por el tenant en los tokens del tema.
 *
 * Sobrescribiendo `--primary` y `--primary-foreground` en el root de la carta,
 * TODO lo que ya usa `bg-primary`/`text-primary` sigue la marca del tenant sin
 * tocar una sola clase — ése es el pago del sistema de tokens.
 */
export function brandTokens(hex: string): BrandTokens {
  const fg = readableTextOn(hex);
  return {
    primary: hexToHslTriplet(hex),
    primaryForeground: hexToHslTriplet(fg),
    contrast: contrastRatio(hex, fg),
  };
}

/** Color de marca por defecto — el berry de Chillberry. */
export const DEFAULT_BRAND_COLOR = '#D41C6F';
