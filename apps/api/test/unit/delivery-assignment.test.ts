import { describe, expect, it } from 'vitest';
import { computeDriverPerformanceScore, haversineKm, rankDriverCandidates } from '@chillberry/domain';

describe('haversineKm', () => {
  it('devuelve ~0 para el mismo punto', () => {
    expect(haversineKm(-25.2637, -57.5759, -25.2637, -57.5759)).toBeCloseTo(0, 5);
  });

  it('calcula la distancia real entre Asunción y Encarnación (~300km en línea recta)', () => {
    // Asunción: -25.2637,-57.5759 · Encarnación: -27.3306,-55.8664
    const km = haversineKm(-25.2637, -57.5759, -27.3306, -55.8664);
    expect(km).toBeGreaterThan(250);
    expect(km).toBeLessThan(320);
  });
});

describe('computeDriverPerformanceScore', () => {
  it('usa 3.0/5.0 como rating neutral cuando el repartidor no tiene rating todavía', () => {
    const scoreNoRating = computeDriverPerformanceScore(null, 0, 0);
    const scoreWithNeutralRating = computeDriverPerformanceScore(3.0, 0, 0);
    expect(scoreNoRating).toBeCloseTo(scoreWithNeutralRating, 10);
  });

  it('un repartidor con mejor rating y mejor completionRate saca mejor score', () => {
    const good = computeDriverPerformanceScore(5.0, 100, 0);
    const bad = computeDriverPerformanceScore(2.0, 5, 20);
    expect(good).toBeGreaterThan(bad);
  });

  it('el score siempre queda en [0,1]', () => {
    expect(computeDriverPerformanceScore(5.0, 1000, 0)).toBeLessThanOrEqual(1);
    expect(computeDriverPerformanceScore(0, 0, 1000)).toBeGreaterThanOrEqual(0);
  });
});

describe('rankDriverCandidates', () => {
  it('prioriza distancia sobre todo lo demás', () => {
    const candidates = [
      { id: 'lejos-pero-libre', distanceKm: 10, activeDeliveriesCount: 0, performanceScore: 1 },
      { id: 'cerca-pero-ocupado', distanceKm: 1, activeDeliveriesCount: 5, performanceScore: 0.1 },
    ];
    expect(rankDriverCandidates(candidates)[0]!.id).toBe('cerca-pero-ocupado');
  });

  it('a igual distancia, prioriza menor carga activa', () => {
    const candidates = [
      { id: 'ocupado', distanceKm: 5, activeDeliveriesCount: 3, performanceScore: 0.9 },
      { id: 'libre', distanceKm: 5, activeDeliveriesCount: 0, performanceScore: 0.5 },
    ];
    expect(rankDriverCandidates(candidates)[0]!.id).toBe('libre');
  });

  it('a igual distancia y carga, prioriza mejor performanceScore', () => {
    const candidates = [
      { id: 'peor', distanceKm: 5, activeDeliveriesCount: 1, performanceScore: 0.3 },
      { id: 'mejor', distanceKm: 5, activeDeliveriesCount: 1, performanceScore: 0.8 },
    ];
    expect(rankDriverCandidates(candidates)[0]!.id).toBe('mejor');
  });

  it('no muta el array original', () => {
    const candidates = [
      { id: 'b', distanceKm: 2, activeDeliveriesCount: 0, performanceScore: 0 },
      { id: 'a', distanceKm: 1, activeDeliveriesCount: 0, performanceScore: 0 },
    ];
    const original = [...candidates];
    rankDriverCandidates(candidates);
    expect(candidates).toEqual(original);
  });

  it('sin repartidores online (array vacío) devuelve array vacío, no lanza', () => {
    expect(rankDriverCandidates([])).toEqual([]);
  });
});
