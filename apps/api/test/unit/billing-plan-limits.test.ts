import { describe, expect, it } from 'vitest';
import { canCreateBranch, canDowngradeToPlan } from '@chillberry/domain';

describe('canCreateBranch', () => {
  it('permite crear la primera sucursal en un plan STARTER (max 1)', () => {
    expect(canCreateBranch(0, 1)).toBe(true);
  });

  it('bloquea la segunda sucursal en un plan STARTER (max 1)', () => {
    expect(canCreateBranch(1, 1)).toBe(false);
  });

  it('permite crear hasta el límite exacto en un plan con más margen', () => {
    expect(canCreateBranch(4, 5)).toBe(true);
    expect(canCreateBranch(5, 5)).toBe(false);
  });
});

describe('canDowngradeToPlan', () => {
  it('permite el downgrade si el uso actual entra justo en el límite nuevo', () => {
    expect(canDowngradeToPlan(1, 1)).toBe(true);
  });

  it('bloquea el downgrade si el uso actual excede el límite nuevo', () => {
    expect(canDowngradeToPlan(3, 1)).toBe(false);
  });

  it('permite el downgrade con margen de sobra', () => {
    expect(canDowngradeToPlan(0, 5)).toBe(true);
  });
});
