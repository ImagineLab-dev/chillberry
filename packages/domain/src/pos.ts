export const CASH_SESSION_STATUS = {
  Open: 'OPEN',
  Closed: 'CLOSED',
} as const;

export type CashSessionStatus = (typeof CASH_SESSION_STATUS)[keyof typeof CASH_SESSION_STATUS];

export const CASH_MOVEMENT_TYPE = {
  Sale: 'SALE',
  Refund: 'REFUND',
  PayIn: 'PAY_IN',
  PayOut: 'PAY_OUT',
  Discount: 'DISCOUNT',
} as const;

export type CashMovementType = (typeof CASH_MOVEMENT_TYPE)[keyof typeof CASH_MOVEMENT_TYPE];

export const DISCOUNT_TYPE = {
  Percentage: 'PERCENTAGE',
  FixedAmount: 'FIXED_AMOUNT',
  Coupon: 'COUPON',
} as const;

export type DiscountType = (typeof DISCOUNT_TYPE)[keyof typeof DISCOUNT_TYPE];
