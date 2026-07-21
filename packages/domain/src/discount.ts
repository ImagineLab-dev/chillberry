/**
 * Aplicación de un descuento sobre un pedido — la matemática compartida entre
 * el POS (descuento manual) y la fidelización (canje de puntos).
 *
 * Es una función pura, sin dependencias ni excepciones HTTP, justamente para
 * que los dos caminos usen exactamente la MISMA validación de tope. Duplicarla
 * fue lo que dejó pasar el bug de descuentos acumulados que dejaba el total en
 * negativo; centralizarla evita que vuelva a divergir.
 */

export type DiscountApplication =
  | { ok: true; amount: number; newDiscountTotal: number; newTotal: number }
  | { ok: false; reason: 'exceeds_total'; discountableRemaining: number };

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * @param subtotal        subtotal del pedido
 * @param taxTotal        impuestos del pedido
 * @param discountedSoFar descuento ya acumulado en el pedido
 * @param amount          monto de descuento nuevo que se quiere aplicar
 */
export function applyDiscountToOrder(
  subtotal: number,
  taxTotal: number,
  discountedSoFar: number,
  amount: number,
): DiscountApplication {
  const discountable = round(subtotal + taxTotal);
  const newDiscountTotal = round(discountedSoFar + amount);

  // Se valida el ACUMULADO, no el descuento suelto: dos descuentos que de a uno
  // pasan pueden juntos superar el total y dejarlo negativo (incobrable).
  if (newDiscountTotal > discountable) {
    return { ok: false, reason: 'exceeds_total', discountableRemaining: round(discountable - discountedSoFar) };
  }

  return { ok: true, amount: round(amount), newDiscountTotal, newTotal: round(discountable - newDiscountTotal) };
}
