export const PAYMENT_STATUS = {
  Pending: 'PENDING',
  Processing: 'PROCESSING',
  Approved: 'APPROVED',
  Failed: 'FAILED',
  Refunded: 'REFUNDED',
  Cancelled: 'CANCELLED',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_METHOD = {
  Cash: 'CASH',
  Card: 'CARD',
  Transfer: 'TRANSFER',
  Qr: 'QR',
  Wallet: 'WALLET',
} as const;

export type PaymentMethod = (typeof PAYMENT_METHOD)[keyof typeof PAYMENT_METHOD];

export const PAYMENT_PROVIDER = {
  Bancard: 'BANCARD',
  MercadoPago: 'MERCADO_PAGO',
  Stripe: 'STRIPE',
  Dlocal: 'DLOCAL',
  // Proveedor sandbox propio — no llama a ningún servicio externo. Permite
  // probar el flujo completo de intent + webhook + idempotencia sin
  // credenciales reales de ningún proveedor.
  Mock: 'MOCK',
  CashManual: 'CASH_MANUAL',
} as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDER)[keyof typeof PAYMENT_PROVIDER];
