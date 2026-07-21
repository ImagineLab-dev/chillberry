import type { Tone } from '@/components/ui';

/**
 * Etiquetas en castellano para los enums que el personal ve en pantalla.
 *
 * Existe porque las pantallas del mozo y del repartidor renderizaban el enum
 * CRUDO del backend: un mozo en el salón leía "OCCUPIED" y "READY", y un
 * repartidor "DRIVER_ASSIGNED". Son las dos pantallas que usa gente que no
 * trabaja con computadoras, en el celular y apurada.
 *
 * El texto del cliente final NO vive acá: en `/track` los estados se cuentan
 * desde su punto de vista ("Tu pedido está en camino"), que no es lo que le
 * sirve leer al repartidor sobre la misma entrega.
 */

// --------------------------------------------------------------------- mesas

export const TABLE_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Libre',
  OCCUPIED: 'Ocupada',
  RESERVED: 'Reservada',
};

export const TABLE_STATUS_TONE: Record<string, Tone> = {
  AVAILABLE: 'ok',
  OCCUPIED: 'error',
  RESERVED: 'warn',
};

// ------------------------------------------------------------------- pedidos

/** Estado del pedido tal como le sirve leerlo al MOZO (no al comensal). */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  WAITING: 'En espera',
  ACCEPTED: 'Tomado en cocina',
  PREPARING: 'En preparación',
  READY: 'Listo para servir',
  COMPLETED: 'Servido',
  CANCELLED: 'Cancelado',
};

export const ORDER_STATUS_TONE: Record<string, Tone> = {
  WAITING: 'neutral',
  ACCEPTED: 'info',
  PREPARING: 'warn',
  READY: 'ok',
  COMPLETED: 'neutral',
  CANCELLED: 'error',
};

// ----------------------------------------------------------------- deliveries

/** Estado de la entrega desde el punto de vista del REPARTIDOR. */
export const DELIVERY_STATUS_LABEL_DRIVER: Record<string, string> = {
  PENDING: 'Sin asignar',
  DRIVER_ASSIGNED: 'Asignada a vos',
  ACCEPTED: 'Aceptada — pasá a retirar',
  PICKED_UP: 'Retirada — en camino',
  DELIVERED: 'Entregada',
  DRIVER_CANCELLED: 'La cancelaste',
  CUSTOMER_CANCELLED: 'Cancelada por el cliente',
  RESTAURANT_CANCELLED: 'Cancelada por el local',
  FAILED: 'No se pudo entregar',
};

export const DELIVERY_STATUS_TONE: Record<string, Tone> = {
  PENDING: 'neutral',
  DRIVER_ASSIGNED: 'warn',
  ACCEPTED: 'info',
  PICKED_UP: 'info',
  DELIVERED: 'ok',
  DRIVER_CANCELLED: 'error',
  CUSTOMER_CANCELLED: 'error',
  RESTAURANT_CANCELLED: 'error',
  FAILED: 'error',
};
