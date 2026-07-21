export const VEHICLE_TYPE = {
  Motorcycle: 'MOTORCYCLE',
  Bicycle: 'BICYCLE',
  Car: 'CAR',
  OnFoot: 'ON_FOOT',
} as const;

export type VehicleType = (typeof VEHICLE_TYPE)[keyof typeof VEHICLE_TYPE];

export const DRIVER_AVAILABILITY = {
  Online: 'ONLINE',
  Offline: 'OFFLINE',
  Busy: 'BUSY',
} as const;

export type DriverAvailability = (typeof DRIVER_AVAILABILITY)[keyof typeof DRIVER_AVAILABILITY];

export const DELIVERY_STATUS = {
  Pending: 'PENDING',
  DriverAssigned: 'DRIVER_ASSIGNED',
  Accepted: 'ACCEPTED',
  PickedUp: 'PICKED_UP',
  Delivered: 'DELIVERED',
  DriverCancelled: 'DRIVER_CANCELLED',
  CustomerCancelled: 'CUSTOMER_CANCELLED',
  RestaurantCancelled: 'RESTAURANT_CANCELLED',
  Failed: 'FAILED',
} as const;

export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

export const DELIVERY_ALLOWED_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  PENDING: ['DRIVER_ASSIGNED', 'RESTAURANT_CANCELLED', 'CUSTOMER_CANCELLED', 'FAILED'],
  DRIVER_ASSIGNED: ['ACCEPTED', 'DRIVER_CANCELLED', 'RESTAURANT_CANCELLED', 'CUSTOMER_CANCELLED'],
  ACCEPTED: ['PICKED_UP', 'DRIVER_CANCELLED', 'RESTAURANT_CANCELLED', 'CUSTOMER_CANCELLED'],
  PICKED_UP: ['DELIVERED', 'DRIVER_CANCELLED', 'FAILED'],
  DELIVERED: [],
  DRIVER_CANCELLED: [],
  CUSTOMER_CANCELLED: [],
  RESTAURANT_CANCELLED: [],
  FAILED: [],
};

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Solo estos estados son "visibles en tránsito" para el tracking público. */
export const DELIVERY_TRACKABLE_STATUSES: readonly DeliveryStatus[] = ['ACCEPTED', 'PICKED_UP'];

export const DELIVERY_FEE_TYPE = {
  Fixed: 'FIXED',
  ByZone: 'BY_ZONE',
  ByDistance: 'BY_DISTANCE',
} as const;

export type DeliveryFeeType = (typeof DELIVERY_FEE_TYPE)[keyof typeof DELIVERY_FEE_TYPE];

export const INCIDENT_TYPE = {
  CustomerUnreachable: 'CUSTOMER_UNREACHABLE',
  WrongAddress: 'WRONG_ADDRESS',
  DamagedOrder: 'DAMAGED_ORDER',
  Delay: 'DELAY',
  Other: 'OTHER',
} as const;

export type IncidentType = (typeof INCIDENT_TYPE)[keyof typeof INCIDENT_TYPE];

export const INCIDENT_STATUS = {
  Open: 'OPEN',
  Resolved: 'RESOLVED',
} as const;

export type IncidentStatus = (typeof INCIDENT_STATUS)[keyof typeof INCIDENT_STATUS];

/** Distancia en línea recta entre dos coordenadas (fórmula de Haversine), en km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Score de desempeño de un repartidor (0-1): 60% rating, 40% tasa de
 * completado. Un repartidor sin rating todavía (recién dado de alta) usa
 * 3.0/5.0 como neutral en vez de penalizarlo por falta de historial.
 */
export function computeDriverPerformanceScore(
  ratingAvg: number | null,
  totalDeliveries: number,
  totalCancellations: number,
): number {
  const completionRate = totalDeliveries / (totalDeliveries + totalCancellations + 1);
  const ratingComponent = (ratingAvg ?? 3.0) / 5.0;
  return 0.6 * ratingComponent + 0.4 * completionRate;
}

export type DriverCandidate = {
  distanceKm: number;
  activeDeliveriesCount: number;
  performanceScore: number;
};

/**
 * Algoritmo de asignación de repartidor — orden de prioridad: (1) más
 * cercano, (2) menor carga activa, (3) mejor desempeño. Orden compuesto y no
 * un score único a propósito: mantiene el criterio auditable ("por qué se
 * eligió a este repartidor" se puede explicar en una frase, no en un
 * número). No muta el array de entrada.
 */
export function rankDriverCandidates<T extends DriverCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(
    (a, b) =>
      a.distanceKm - b.distanceKm ||
      a.activeDeliveriesCount - b.activeDeliveriesCount ||
      b.performanceScore - a.performanceScore,
  );
}
