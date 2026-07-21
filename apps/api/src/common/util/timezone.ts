/**
 * Helpers de timezone del tenant. Antes reportes y dashboard bucketeaban por
 * hora del SERVIDOR (o UTC), así que para un tenant en otro huso la "venta de
 * hoy", la curva diaria y la hora pico se corrían. Estos helpers usan
 * `Intl.DateTimeFormat` (sin dependencias) para trabajar en el huso del tenant.
 */

/** "YYYY-MM-DD" de una fecha en el timezone dado (IANA, ej. 'America/Asuncion'). */
export function zonedDayKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Hora local (0-23) de una fecha en el timezone dado. */
export function zonedHour(date: Date, tz: string): number {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(date),
  );
  return h % 24; // algunos locales devuelven '24' a medianoche
}

/** Offset del timezone en minutos en el instante `at` (positivo = adelante de UTC). */
function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) if (part.type !== 'literal') p[part.type] = part.value;
  const hour = Number(p.hour) % 24;
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return (asIfUtc - at.getTime()) / 60_000;
}

/** Instante UTC del comienzo del día LOCAL (en tz) que contiene `at` (default: ahora). */
export function startOfDayInTz(tz: string, at: Date = new Date()): Date {
  const key = zonedDayKey(at, tz); // YYYY-MM-DD local en tz
  const utcMidnight = new Date(`${key}T00:00:00Z`);
  const offset = tzOffsetMinutes(tz, utcMidnight);
  return new Date(utcMidnight.getTime() - offset * 60_000);
}

/** Comienzo del día LOCAL siguiente (para acotar "hoy"). */
export function startOfNextDayInTz(tz: string, at: Date = new Date()): Date {
  const start = startOfDayInTz(tz, at);
  // +26h y re-normalizar cubre DST sin romper (rara vez aplica en LATAM).
  return startOfDayInTz(tz, new Date(start.getTime() + 26 * 60 * 60 * 1000));
}

/** ¿Es un timezone IANA válido? */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
