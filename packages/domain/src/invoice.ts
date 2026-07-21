export const INVOICE_KIND = {
  Receipt: 'RECEIPT',
  FiscalInvoice: 'FISCAL_INVOICE',
  CreditNote: 'CREDIT_NOTE',
} as const;

export type InvoiceKind = (typeof INVOICE_KIND)[keyof typeof INVOICE_KIND];

export const INVOICE_STATUS = {
  Draft: 'DRAFT',
  Issued: 'ISSUED',
  Cancelled: 'CANCELLED',
} as const;

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];
