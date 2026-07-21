export const BILL_SPLIT_MODE = {
  ByPerson: 'BY_PERSON',
  ByItem: 'BY_ITEM',
} as const;

export type BillSplitMode = (typeof BILL_SPLIT_MODE)[keyof typeof BILL_SPLIT_MODE];

/** Tolerancia de redondeo al validar que la suma de partes == total del pedido. */
export const BILL_SPLIT_ROUNDING_TOLERANCE = 0.01;
