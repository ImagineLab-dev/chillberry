export const TABLE_STATUS = {
  Available: 'AVAILABLE',
  Occupied: 'OCCUPIED',
  Reserved: 'RESERVED',
} as const;

export type TableStatus = (typeof TABLE_STATUS)[keyof typeof TABLE_STATUS];
