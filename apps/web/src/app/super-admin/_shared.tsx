import { formatMoneyByCurrency } from '@chillberry/domain';
import type { Tone } from '@/components/ui';

/**
 * Tipos y helpers compartidos por las pantallas del panel interno. Prefijo `_`
 * = carpeta privada de Next: no genera ruta.
 */

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';

export type PlanRef = {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  currency: string;
  limits?: { maxBranches: number; maxUsers: number };
};

export type Usage = { branches: number; users: number; orders: number };

export type TenantListItem = {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  currency: string;
  active: boolean;
  createdAt: string;
  subscription: {
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    renewalDate: string | null;
    plan: PlanRef;
  } | null;
  usage: Usage;
};

export type TenantsPage = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: TenantListItem[];
};

export type TenantDetail = {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  currency: string;
  timezone: string;
  active: boolean;
  createdAt: string;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    renewalDate: string | null;
    pastDueSince: string | null;
    cancelledAt: string | null;
    createdAt: string;
    plan: PlanRef;
    pendingPlan: { id: string; code: string; name: string } | null;
  } | null;
  restaurants: Array<{
    id: string;
    name: string;
    active: boolean;
    createdAt: string;
    branches: Array<{ id: string; name: string; address: string; active: boolean }>;
  }>;
  usage: Usage;
  invoices: Array<{
    id: string;
    amount: string;
    currency: string;
    status: 'PENDING' | 'PAID' | 'FAILED';
    periodStart: string;
    periodEnd: string;
    paidAt: string | null;
    createdAt: string;
    plan: { code: string; name: string };
  }>;
};

export type Metrics = {
  totalTenants: number;
  byStatus: Record<SubscriptionStatus | 'WITHOUT_SUBSCRIPTION', number>;
  byPlan: Array<{
    planId: string;
    code: string;
    name: string;
    priceMonthly: string | null;
    currency: string | null;
    tenants: number;
  }>;
  mrr: Array<{ currency: string; amount: number; tenants: number }>;
  signupsByMonth: Array<{ month: string; count: number }>;
  byCountry: Array<{ countryCode: string; tenants: number }>;
};

export type AuditPage = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: Array<{
    id: string;
    action: string;
    detail: Record<string, unknown> | null;
    createdAt: string;
    superAdmin: { id: string; name: string | null; email: string | null };
    targetTenant: { id: string; name: string | null; slug: string | null };
  }>;
};

// `ok` = cobrando; `warn` = todavía no paga pero no es un problema (trial) o
// está por serlo (past due); `error` = no está operando.
export const STATUS_TONE: Record<SubscriptionStatus, Tone> = {
  TRIAL: 'warn',
  ACTIVE: 'ok',
  PAST_DUE: 'warn',
  CANCELLED: 'error',
  SUSPENDED: 'error',
};

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIAL: 'Prueba',
  ACTIVE: 'Activo',
  PAST_DUE: 'Pago pendiente',
  CANCELLED: 'Cancelado',
  SUSPENDED: 'Suspendido',
};

export const INVOICE_TONE: Record<'PENDING' | 'PAID' | 'FAILED', Tone> = {
  PENDING: 'warn',
  PAID: 'ok',
  FAILED: 'error',
};

export const ACTION_LABEL: Record<string, string> = {
  CHANGE_PLAN: 'Cambio de plan',
  SUSPEND_SUBSCRIPTION: 'Suspensión',
  REACTIVATE_SUBSCRIPTION: 'Reactivación',
};

export const ACTION_TONE: Record<string, Tone> = {
  CHANGE_PLAN: 'info',
  SUSPEND_SUBSCRIPTION: 'error',
  REACTIVATE_SUBSCRIPTION: 'ok',
};

/**
 * Precio de un plan. Va SIEMPRE con la moneda del plan (`plan.currency`,
 * hoy USD), nunca con la del tenant: un restaurante paraguayo opera en ₲ pero
 * su suscripción está cotizada en USD. Formatear USD 79 con `formatMoney(79,
 * 'PY')` mostraría "₲ 79", un precio que no existe.
 */
export function planPrice(priceMonthly: string | null, currency: string | null): string {
  if (priceMonthly === null || currency === null) return '—';
  return formatMoneyByCurrency(priceMonthly, currency);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-419', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-419', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "2026-07" -> "jul 26" para los ejes del gráfico de altas. */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString('es-419', { month: 'short', year: '2-digit' });
}
