export const STATION_TYPE = {
  HotKitchen: 'HOT_KITCHEN',
  Drinks: 'DRINKS',
  Desserts: 'DESSERTS',
  Grill: 'GRILL',
} as const;

export type StationType = (typeof STATION_TYPE)[keyof typeof STATION_TYPE];

export const STATION_LABELS: Record<StationType, string> = {
  HOT_KITCHEN: 'Cocina caliente',
  DRINKS: 'Bebidas',
  DESSERTS: 'Postres',
  GRILL: 'Parrilla',
};

export const KITCHEN_TASK_STATUS = {
  New: 'NEW',
  InProgress: 'IN_PROGRESS',
  Ready: 'READY',
  Delivered: 'DELIVERED',
} as const;

export type KitchenTaskStatus = (typeof KITCHEN_TASK_STATUS)[keyof typeof KITCHEN_TASK_STATUS];

export const KITCHEN_TASK_ALLOWED_TRANSITIONS: Record<KitchenTaskStatus, readonly KitchenTaskStatus[]> = {
  NEW: ['IN_PROGRESS'],
  IN_PROGRESS: ['READY'],
  READY: ['DELIVERED'],
  DELIVERED: [],
};

export function canTransitionKitchenTask(from: KitchenTaskStatus, to: KitchenTaskStatus): boolean {
  return KITCHEN_TASK_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Umbral (minutos) tras el cual el KDS marca una tarea como "retrasada". */
export const KITCHEN_TASK_DELAY_MINUTES = 15;
