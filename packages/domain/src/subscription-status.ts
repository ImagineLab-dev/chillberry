export const SUBSCRIPTION_STATUS = {
  Trial: 'TRIAL',
  Active: 'ACTIVE',
  PastDue: 'PAST_DUE',
  Cancelled: 'CANCELLED',
  Suspended: 'SUSPENDED',
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const SUBSCRIPTION_INVOICE_STATUS = {
  Pending: 'PENDING',
  Paid: 'PAID',
  Failed: 'FAILED',
} as const;

export type SubscriptionInvoiceStatus =
  (typeof SUBSCRIPTION_INVOICE_STATUS)[keyof typeof SUBSCRIPTION_INVOICE_STATUS];

/** Límites/features que vive en `Plan.limits` / `Plan.features` (JSON). */
export type PlanLimits = {
  maxBranches: number;
  maxUsers: number;
};

export type PlanFeatures = {
  delivery: boolean;
  /** Avisos push al teléfono del cliente y del personal. */
  push: boolean;
  invoicing: boolean;
};

/** Usado antes de crear una Branch nueva: bloquea al llegar al tope del plan. */
export function canCreateBranch(currentBranchCount: number, maxBranches: number): boolean {
  return currentBranchCount < maxBranches;
}

/** Usado en change-plan: un downgrade solo se permite si el uso actual ya cabe en el plan nuevo. */
export function canDowngradeToPlan(currentBranchCount: number, newPlanMaxBranches: number): boolean {
  return currentBranchCount <= newPlanMaxBranches;
}
