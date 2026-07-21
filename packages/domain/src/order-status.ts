export const ORDER_STATUS = {
  Waiting: 'WAITING',
  Accepted: 'ACCEPTED',
  Preparing: 'PREPARING',
  Ready: 'READY',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_TYPE = {
  DineIn: 'DINE_IN',
  Takeaway: 'TAKEAWAY',
  Delivery: 'DELIVERY',
} as const;

export type OrderType = (typeof ORDER_TYPE)[keyof typeof ORDER_TYPE];

/**
 * Transiciones válidas del pedido. A partir de Fase 1 (KDS), READY pasa a
 * derivarse automáticamente de que todas las KitchenTask estén READY — pero
 * esta tabla sigue siendo el contrato de validación para PATCH manual
 * (ej. WAITER marcando listo un pedido sin estaciones aún, o Fase 0 sin KDS).
 */
export const ORDER_ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  WAITING: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
