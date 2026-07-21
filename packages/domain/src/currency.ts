/**
 * Países/monedas soportados — curado a los mercados de Latam donde DLocal
 * realmente opera y donde Chillberry se va a promocionar, no la lista
 * completa de 30+ países de DLocal (India, Nigeria, Vietnam, etc. quedan
 * fuera de alcance por ahora). Agregar un país acá alcanza para que aparezca
 * en el selector de registro y en Configuración — no hace falta tocar
 * ningún otro archivo.
 */
export type DlocalCountry = {
  countryCode: string;
  countryName: string;
  currency: string;
  currencySymbol: string;
};

export const DLOCAL_COUNTRIES: readonly DlocalCountry[] = [
  { countryCode: 'PY', countryName: 'Paraguay', currency: 'PYG', currencySymbol: '₲' },
  { countryCode: 'AR', countryName: 'Argentina', currency: 'ARS', currencySymbol: '$' },
  { countryCode: 'BR', countryName: 'Brasil', currency: 'BRL', currencySymbol: 'R$' },
  { countryCode: 'BO', countryName: 'Bolivia', currency: 'BOB', currencySymbol: 'Bs' },
  { countryCode: 'CL', countryName: 'Chile', currency: 'CLP', currencySymbol: '$' },
  { countryCode: 'CO', countryName: 'Colombia', currency: 'COP', currencySymbol: '$' },
  { countryCode: 'CR', countryName: 'Costa Rica', currency: 'CRC', currencySymbol: '₡' },
  { countryCode: 'DO', countryName: 'República Dominicana', currency: 'DOP', currencySymbol: 'RD$' },
  { countryCode: 'EC', countryName: 'Ecuador', currency: 'USD', currencySymbol: '$' },
  { countryCode: 'SV', countryName: 'El Salvador', currency: 'USD', currencySymbol: '$' },
  { countryCode: 'GT', countryName: 'Guatemala', currency: 'GTQ', currencySymbol: 'Q' },
  { countryCode: 'HN', countryName: 'Honduras', currency: 'HNL', currencySymbol: 'L' },
  { countryCode: 'MX', countryName: 'México', currency: 'MXN', currencySymbol: '$' },
  { countryCode: 'PA', countryName: 'Panamá', currency: 'USD', currencySymbol: '$' },
  { countryCode: 'PE', countryName: 'Perú', currency: 'PEN', currencySymbol: 'S/' },
  { countryCode: 'UY', countryName: 'Uruguay', currency: 'UYU', currencySymbol: '$U' },
] as const;

export const DEFAULT_DLOCAL_COUNTRY_CODE = 'PY';

export function findDlocalCountry(countryCode: string): DlocalCountry | undefined {
  return DLOCAL_COUNTRIES.find((c) => c.countryCode === countryCode);
}

export function isDlocalCountryCode(countryCode: string): boolean {
  return DLOCAL_COUNTRIES.some((c) => c.countryCode === countryCode);
}

/** Formatea un monto con el símbolo de moneda del país, ej. "₲ 27.000". */
export function formatMoney(amount: number | string, countryCode: string): string {
  const country = findDlocalCountry(countryCode);
  const symbol = country?.currencySymbol ?? '';
  const n = Number(amount);
  const formatted = Number.isFinite(n) ? n.toLocaleString('es-419') : String(amount);
  return symbol ? `${symbol} ${formatted}` : formatted;
}

/**
 * Formatea por moneda ISO en vez de por país, ej. "USD 108".
 *
 * Existe porque `formatMoney` necesita un `countryCode`, y hay montos que NO
 * pertenecen a ningún país: el precio de un `Plan` está cotizado en
 * `Plan.currency` (hoy USD para los tres), que es INDEPENDIENTE de la moneda
 * operativa del tenant que lo paga (ver comentario de `Tenant.currency` en
 * schema.prisma). Un tenant paraguayo en el plan Pro paga USD 79, no ₲ 79 —
 * usar `formatMoney(79, 'PY')` ahí renderizaría "₲ 79", que es un monto que
 * no existe.
 *
 * Muestra el código ISO y no el símbolo a propósito: "$" es ambiguo entre
 * USD, ARS, CLP, COP y MXN — en un agregado que mezcla monedas (el MRR del
 * SaaS) el símbolo solo haría que dos cifras distintas se lean igual.
 */
export function formatMoneyByCurrency(amount: number | string, currency: string): string {
  const n = Number(amount);
  const formatted = Number.isFinite(n) ? n.toLocaleString('es-419') : String(amount);
  return `${currency} ${formatted}`;
}
