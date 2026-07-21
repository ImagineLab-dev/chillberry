import { describe, expect, it } from 'vitest';
import { canTransitionOrder, canTransitionDelivery, canTransitionKitchenTask } from '@chillberry/domain';

describe('canTransitionOrder', () => {
  it('permite WAITING -> ACCEPTED', () => {
    expect(canTransitionOrder('WAITING', 'ACCEPTED')).toBe(true);
  });

  it('permite cancelar desde cualquier estado no terminal', () => {
    expect(canTransitionOrder('WAITING', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('PREPARING', 'CANCELLED')).toBe(true);
  });

  it('rechaza saltar etapas (WAITING -> READY)', () => {
    expect(canTransitionOrder('WAITING', 'READY')).toBe(false);
  });

  it('rechaza cualquier transición desde estados terminales', () => {
    expect(canTransitionOrder('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canTransitionOrder('CANCELLED', 'WAITING')).toBe(false);
  });

  it('rechaza retroceder (READY -> PREPARING)', () => {
    expect(canTransitionOrder('READY', 'PREPARING')).toBe(false);
  });
});

describe('canTransitionDelivery', () => {
  it('permite el flujo feliz completo', () => {
    expect(canTransitionDelivery('PENDING', 'DRIVER_ASSIGNED')).toBe(true);
    expect(canTransitionDelivery('DRIVER_ASSIGNED', 'ACCEPTED')).toBe(true);
    expect(canTransitionDelivery('ACCEPTED', 'PICKED_UP')).toBe(true);
    expect(canTransitionDelivery('PICKED_UP', 'DELIVERED')).toBe(true);
  });

  it('rechaza entregar sin haber sido recogido', () => {
    expect(canTransitionDelivery('ACCEPTED', 'DELIVERED')).toBe(false);
  });

  it('permite cancelaciones desde estados activos pero no desde DELIVERED', () => {
    expect(canTransitionDelivery('DRIVER_ASSIGNED', 'CUSTOMER_CANCELLED')).toBe(true);
    expect(canTransitionDelivery('DELIVERED', 'CUSTOMER_CANCELLED')).toBe(false);
  });

  it('rechaza un status desconocido como origen', () => {
    expect(canTransitionDelivery('NOT_A_REAL_STATUS' as never, 'PENDING')).toBe(false);
  });
});

describe('canTransitionKitchenTask', () => {
  it('permite el flujo lineal NEW -> IN_PROGRESS -> READY -> DELIVERED', () => {
    expect(canTransitionKitchenTask('NEW', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionKitchenTask('IN_PROGRESS', 'READY')).toBe(true);
    expect(canTransitionKitchenTask('READY', 'DELIVERED')).toBe(true);
  });

  it('rechaza saltar de NEW directo a READY', () => {
    expect(canTransitionKitchenTask('NEW', 'READY')).toBe(false);
  });

  it('rechaza cualquier transición desde DELIVERED', () => {
    expect(canTransitionKitchenTask('DELIVERED', 'NEW')).toBe(false);
  });
});
