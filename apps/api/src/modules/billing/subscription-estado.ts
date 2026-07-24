/**
 * ¿La suscripción de un tenant permite OPERAR (escribir), o quedó en solo
 * lectura? Decisión de producto (22/07/2026): al vencer la prueba o cumplirse
 * la cancelación NO se corta el acceso — se pasa a SOLO LECTURA con un banner
 * permanente dirigiendo al pago. Así el dueño ve sus datos intactos (la
 * motivación más fuerte para pagar) pero no puede seguir operando gratis.
 *
 * Función PURA y compartida: la usan el guard global de escrituras
 * (subscription.guard), el endpoint del banner (`GET /billing/estado`) y el
 * bloqueo de pedidos públicos (public-menu). Una sola definición de "vencida"
 * — tres lugares que jamás pueden discrepar.
 *
 * Qué bloquea y qué no:
 *  - TRIAL con `trialEndsAt` pasado            → bloqueada (TRIAL_VENCIDO)
 *  - `cancelledAt` seteado y período cumplido  → bloqueada (CANCELADA)
 *  - status CANCELLED / SUSPENDED              → bloqueada
 *  - PAST_DUE                                  → NO bloquea (tiene su CTA de
 *    pago; cortar por un cobro demorado del proveedor castigaría a un cliente
 *    que quiere pagar)
 *  - ACTIVE con `renewalDate` vencida SIN cancelar → NO bloquea (puede ser un
 *    webhook de renovación demorado — bloquear ahí es cortarle el servicio a
 *    un cliente al día por la lentitud del proveedor de pagos)
 */

export type MotivoBloqueo = 'TRIAL_VENCIDO' | 'CANCELADA' | 'SUSPENDIDA';

export type EstadoBloqueo = { bloqueada: boolean; motivo: MotivoBloqueo | null };

type SubMinima = {
  status: string;
  trialEndsAt: Date | null;
  cancelledAt: Date | null;
  renewalDate: Date | null;
} | null;

export function estadoDeBloqueo(sub: SubMinima, ahora: Date = new Date()): EstadoBloqueo {
  // Sin suscripción: fail-open, mismo criterio que assertCanCreateUser — un
  // problema de billing no puede dejar a un restaurante sin operar.
  if (!sub) return { bloqueada: false, motivo: null };

  if (sub.status === 'SUSPENDED') return { bloqueada: true, motivo: 'SUSPENDIDA' };
  if (sub.status === 'CANCELLED') return { bloqueada: true, motivo: 'CANCELADA' };

  // Cancelación programada ya cumplida: el acceso pagado llegó hasta
  // `renewalDate` (o hasta el fin de la prueba si canceló durante el trial).
  if (sub.cancelledAt) {
    const limite = sub.renewalDate ?? sub.trialEndsAt;
    if (limite && limite < ahora) return { bloqueada: true, motivo: 'CANCELADA' };
  }

  if (sub.status === 'TRIAL' && sub.trialEndsAt && sub.trialEndsAt < ahora) {
    return { bloqueada: true, motivo: 'TRIAL_VENCIDO' };
  }

  return { bloqueada: false, motivo: null };
}
