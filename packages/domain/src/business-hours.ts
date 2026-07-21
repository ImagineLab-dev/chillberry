// Horario de apertura de una sucursal para el pedido online. Puro y testeable:
// la hora local ("¿está abierto AHORA?") se calcula afuera (necesita la zona
// horaria del tenant y `new Date()`, que no son puros) y se pasa como input.

/** Un tramo horario de un día. Minutos desde medianoche, hora local. */
export type WeeklyHours = {
  /** 0=domingo .. 6=sábado (convención de `Date.getDay`). */
  weekday: number;
  openMinute: number;
  closeMinute: number;
};

/** El "ahora" en la zona horaria de la sucursal, ya descompuesto. */
export type LocalMoment = {
  /** 0=domingo .. 6=sábado. */
  weekday: number;
  /** Minutos desde medianoche (0-1439). */
  minutes: number;
  /** Fecha local en formato 'YYYY-MM-DD'. */
  ymd: string;
};

export type OpenState =
  | { open: true }
  | { open: false; reason: 'closed_date' | 'closed_today' | 'outside_hours' };

/**
 * ¿La sucursal acepta pedidos online en este momento?
 *
 * Enforcement OPT-IN: sin horarios NI cierres configurados → siempre abierta
 * (no rompe sucursales que nunca cargaron horario). Reglas, en orden:
 *  1. Si hoy es una fecha de cierre → cerrado todo el día.
 *  2. Si no hay horario semanal cargado → abierto (salvo la regla 1).
 *  3. Si hay horario pero ninguna franja para el día de hoy → cerrado hoy.
 *  4. Si hay franjas hoy pero la hora actual no cae en ninguna → fuera de horario.
 *
 * No contempla franjas que cruzan medianoche (`closeMinute > openMinute`
 * siempre, garantizado por la validación del DTO).
 */
export function isBranchOpen(
  hours: WeeklyHours[],
  closedDates: string[],
  now: LocalMoment,
): OpenState {
  if (closedDates.includes(now.ymd)) return { open: false, reason: 'closed_date' };
  if (hours.length === 0) return { open: true };

  const today = hours.filter((h) => h.weekday === now.weekday);
  if (today.length === 0) return { open: false, reason: 'closed_today' };

  const within = today.some((h) => now.minutes >= h.openMinute && now.minutes < h.closeMinute);
  return within ? { open: true } : { open: false, reason: 'outside_hours' };
}

/** Descompone `date` en la zona horaria IANA dada, sin librerías externas.
 *  Usa `Intl`, que en Node resuelve zonas IANA de fábrica. */
export function localMomentInZone(date: Date, timeZone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  // `hour12:false` puede devolver '24' a la medianoche en algunos entornos.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    minutes: hour * 60 + minute,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/**
 * ¿Estamos dentro de la ventana horaria de DELIVERY? Es un corte ADICIONAL al
 * horario general de la sucursal: un local puede estar abierto hasta las 23h
 * pero dejar de tomar envíos a las 22h. Puro (recibe el "ahora" ya en minutos
 * locales, igual que `isBranchOpen`).
 *
 *  - `start` y `end` en minutos desde medianoche (0-1439), o `null` c/u.
 *  - Ambos `null` → sin restricción específica de delivery (sólo aplica el
 *    horario general). Es el default: no rompe sucursales que no lo configuran.
 *  - Sólo `end` → delivery desde la apertura hasta esa hora (el caso típico
 *    "aceptamos delivery hasta las 22:00").
 *  - Sólo `start` → delivery recién a partir de esa hora.
 *  - Si `end <= start` la ventana CRUZA medianoche (ej. 18:00–02:00): abierto
 *    si `m >= start` O `m < end`.
 */
export function isWithinDeliveryWindow(
  start: number | null,
  end: number | null,
  nowMinutes: number,
): boolean {
  if (start == null && end == null) return true;
  const from = start ?? 0;
  const to = end ?? 1440;
  if (from <= to) return nowMinutes >= from && nowMinutes < to;
  // Ventana que cruza medianoche.
  return nowMinutes >= from || nowMinutes < to;
}
