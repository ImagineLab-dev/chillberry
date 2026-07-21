import { describe, expect, it } from 'vitest';
import { distanciaMetros, necesitaRecalculo, type RutaGuardada } from '../../src/modules/delivery/route-cache';

/**
 * Esta lógica es la que evita que el seguimiento agote la cuota del motor de
 * ruteo. Si se rompe, no falla nada visible: simplemente se empiezan a pedir
 * rutas de más (o de menos, y la línea queda vieja). Por eso conviene fijarla.
 */

const ASUNCION = { lat: -25.2637, lng: -57.5759 };

function guardada(over: Partial<RutaGuardada> = {}): RutaGuardada {
  return {
    geometry: [[-25.26, -57.57]],
    desde: ASUNCION,
    actualizada: new Date('2026-07-21T12:00:00Z'),
    ...over,
  };
}

describe('distanciaMetros', () => {
  it('da cero para el mismo punto', () => {
    expect(distanciaMetros(ASUNCION, ASUNCION)).toBe(0);
  });

  it('mide una distancia conocida con error menor al 1%', () => {
    // Asunción → Luque, ~10,5 km en línea recta.
    const luque = { lat: -25.2667, lng: -57.4833 };
    const m = distanciaMetros(ASUNCION, luque);
    expect(m).toBeGreaterThan(9_000);
    expect(m).toBeLessThan(11_000);
  });
});

describe('necesitaRecalculo', () => {
  const ahora = new Date('2026-07-21T12:01:00Z'); // 1 minuto después

  it('pide ruta si nunca se calculó', () => {
    expect(necesitaRecalculo({ geometry: null, desde: null, actualizada: null }, ASUNCION, ahora)).toBe(true);
  });

  it('pide ruta si quedó a medias (geometría sin origen)', () => {
    expect(necesitaRecalculo(guardada({ desde: null }), ASUNCION, ahora)).toBe(true);
  });

  it('NO pide ruta si es reciente y el repartidor casi no se movió', () => {
    // ~30 m: dentro del ruido del GPS de un celular.
    const casiIgual = { lat: ASUNCION.lat + 0.00027, lng: ASUNCION.lng };
    expect(necesitaRecalculo(guardada(), casiIgual, ahora)).toBe(false);
  });

  it('pide ruta si el repartidor se desvió más de 300 m', () => {
    // ~550 m al norte.
    const desviado = { lat: ASUNCION.lat + 0.005, lng: ASUNCION.lng };
    expect(necesitaRecalculo(guardada(), desviado, ahora)).toBe(true);
  });

  it('pide ruta si pasó la vigencia aunque no se haya movido', () => {
    const tarde = new Date('2026-07-21T12:04:00Z'); // 4 min > 3 de vigencia
    expect(necesitaRecalculo(guardada(), ASUNCION, tarde)).toBe(true);
  });

  it('no se dispara sola parado en un semáforo', () => {
    // El caso que motiva el umbral: quieto, con el GPS oscilando ±40 m,
    // consultando el seguimiento cada pocos segundos. No debe pedir nada.
    for (let i = 0; i < 20; i++) {
      const jitter = {
        lat: ASUNCION.lat + (i % 2 ? 0.00035 : -0.00035),
        lng: ASUNCION.lng + (i % 3 ? 0.0003 : -0.0003),
      };
      expect(necesitaRecalculo(guardada(), jitter, ahora)).toBe(false);
    }
  });
});
