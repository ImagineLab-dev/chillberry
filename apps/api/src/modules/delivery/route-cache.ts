import type { Punto } from './routing.adapter';

/**
 * Cuándo vale la pena volver a pedir la ruta.
 *
 * El repartidor manda su posición cada 20 segundos. Si pidiéramos la ruta en
 * cada ping, una entrega de media hora serían ~90 consultas, y con varios
 * restaurantes a la vez la cuota diaria se agota antes del mediodía.
 *
 * Pero la ruta casi no cambia: lo único que se mueve es el punto del repartidor
 * ENCIMA de ella. Alcanza con recalcular cuando pasó un rato o cuando se desvió
 * de verdad — que es cuando la línea dibujada dejaría de tener sentido.
 */

/** Se rehace pasado este tiempo aunque no se haya desviado (tráfico, desvíos). */
const VIGENCIA_MS = 3 * 60 * 1000;

/**
 * Desvío que amerita recalcular. 300 m es más que el ruido del GPS de un celular
 * (±20-50 m típico, peor entre edificios) pero menos que una cuadra larga mal
 * tomada, así que no se dispara sola parada en un semáforo.
 */
const DESVIO_M = 300;

/** Distancia en metros entre dos coordenadas (Haversine). */
export function distanciaMetros(a: Punto, b: Punto): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface RutaGuardada {
  geometry: unknown;
  desde: Punto | null;
  actualizada: Date | null;
}

/**
 * ¿Hay que pedirle una ruta nueva al servicio?
 *
 * @param guardada Lo que ya tenemos cacheado para esta entrega.
 * @param posicionActual Dónde está el repartidor ahora.
 * @param ahora Se inyecta para poder testearlo sin depender del reloj.
 */
export function necesitaRecalculo(
  guardada: RutaGuardada,
  posicionActual: Punto,
  ahora: Date = new Date(),
): boolean {
  // Nunca se calculó, o quedó incompleta.
  if (!guardada.geometry || !guardada.desde || !guardada.actualizada) return true;

  if (ahora.getTime() - guardada.actualizada.getTime() > VIGENCIA_MS) return true;

  return distanciaMetros(guardada.desde, posicionActual) > DESVIO_M;
}
