import { describe, it, expect } from 'vitest';
import { computeZoneDeliveryFee } from '@chillberry/domain';

/**
 * Cálculo del costo de envío de UNA zona — fuente única compartida por el
 * despacho del staff (`requestDelivery`) y el checkout público. Es plata:
 * cada rama tiene su caso.
 */
describe('computeZoneDeliveryFee', () => {
  const base = {
    baseFee: 5000,
    perKmFee: 1000,
    freeKmThreshold: null as number | null,
    estimatedMinutes: 30,
    minOrderAmount: null as number | null,
  };

  it('FIXED: cobra la tarifa base e ignora la distancia', () => {
    const r = computeZoneDeliveryFee(
      { ...base, feeType: 'FIXED' },
      -25.3,
      -57.6,
      -25.4,
      -57.6, // hay coords, pero FIXED no las usa
    );
    expect(r.fee).toBe(5000);
    expect(r.distanceKm).toBeNull();
  });

  it('BY_DISTANCE: base + km * tarifa por km', () => {
    const r = computeZoneDeliveryFee(
      { ...base, feeType: 'BY_DISTANCE' },
      -25.3,
      -57.6,
      -25.32,
      -57.6,
    );
    expect(r.distanceKm).not.toBeNull();
    const esperado = Math.round((5000 + r.distanceKm! * 1000) * 100) / 100;
    expect(r.fee).toBe(esperado);
    expect(r.fee).toBeGreaterThan(5000);
  });

  it('BY_DISTANCE con umbral sin cargo grande: sólo cobra la base', () => {
    const r = computeZoneDeliveryFee(
      { ...base, feeType: 'BY_DISTANCE', freeKmThreshold: 999 },
      -25.3,
      -57.6,
      -25.32,
      -57.6,
    );
    expect(r.fee).toBe(5000);
  });

  it('BY_DISTANCE sin coordenadas: cae a la base (nunca cobra 0 por falta de datos)', () => {
    const r = computeZoneDeliveryFee({ ...base, feeType: 'BY_DISTANCE' }, null, null, null, null);
    expect(r.fee).toBe(5000);
    expect(r.distanceKm).toBeNull();
  });

  it('propaga estimatedMinutes y minOrderAmount de la zona', () => {
    const r = computeZoneDeliveryFee(
      { ...base, feeType: 'FIXED', estimatedMinutes: 45, minOrderAmount: 30000 },
      null,
      null,
      null,
      null,
    );
    expect(r.estimatedMinutes).toBe(45);
    expect(r.minOrderAmount).toBe(30000);
  });
});
