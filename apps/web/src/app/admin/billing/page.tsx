'use client';

import { useEffect, useState } from 'react';
import { Check, FileText, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, type Tone } from '@/components/ui';
import { SettingsTabs } from '@/components/settings-tabs';

type Plan = {
  id: string;
  code: string;
  name: string;
  priceMonthly: string;
  currency: string;
  limits: { maxBranches: number; maxUsers: number };
  features: { delivery: boolean; whatsapp: boolean; invoicing: boolean };
};

type Subscription = {
  id: string;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';
  planId: string;
  plan: Plan;
  trialEndsAt: string | null;
  renewalDate: string | null;
  usage: { branches: number; maxBranches: number };
};

type SubscriptionInvoice = {
  id: string;
  amount: string;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  createdAt: string;
  plan: { name: string; code: string };
};

const STATUS_TONE: Record<Subscription['status'], Tone> = {
  TRIAL: 'warn',
  ACTIVE: 'ok',
  PAST_DUE: 'warn',
  CANCELLED: 'error',
  SUSPENDED: 'error',
};

const STATUS_LABEL: Record<Subscription['status'], string> = {
  TRIAL: 'Prueba gratuita',
  ACTIVE: 'Activo',
  PAST_DUE: 'Pago pendiente',
  CANCELLED: 'Cancelado',
  SUSPENDED: 'Suspendido',
};

const INVOICE_TONE: Record<SubscriptionInvoice['status'], Tone> = {
  PENDING: 'warn',
  PAID: 'ok',
  FAILED: 'error',
};

/** Features del plan contratado (`GET /billing/features` → `Plan.features`). */
type PlanFeatures = Plan['features'];

const PLAN_FEATURE_ROWS: { key: keyof PlanFeatures; label: string }[] = [
  { key: 'delivery', label: 'Delivery' },
  { key: 'whatsapp', label: 'Avisos por WhatsApp' },
  { key: 'invoicing', label: 'Facturación / comprobantes' },
];

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<SubscriptionInvoice[]>([]);
  const [features, setFeatures] = useState<PlanFeatures | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);

  async function load() {
    const [p, s, i, f] = await Promise.all([
      api.get<Plan[]>('/billing/plans'),
      api.get<Subscription>('/billing/subscription'),
      api.get<SubscriptionInvoice[]>('/billing/invoices'),
      api.get<PlanFeatures>('/billing/features'),
    ]);
    setPlans(p);
    setSubscription(s);
    setInvoices(i);
    setFeatures(f);
  }

  useEffect(() => {
    load().catch((err) => setError((err as ApiError).message));
  }, []);

  async function onChoosePlan(plan: Plan) {
    setError(null);
    setNotice(null);
    setPendingPlanId(plan.id);
    try {
      if (subscription?.status === 'TRIAL') {
        await api.post('/billing/subscribe', { planId: plan.id });
        setNotice(
          `Intento de suscripción a "${plan.name}" creado (sandbox DLocal). En producción esto redirige al checkout de DLocal; acá el plan se activa cuando llega el webhook de aprobación.`,
        );
      } else {
        await api.post('/billing/change-plan', { planId: plan.id });
        setNotice(`Plan actualizado a "${plan.name}".`);
      }
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setPendingPlanId(null);
    }
  }

  if (!subscription) {
    return (
      <div>
        <PageHeader title="Configuración" description="Tu plan, tu consumo y tus facturas." />
        <SettingsTabs />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Configuración" description="Tu plan, tu consumo y tus facturas." />
      <SettingsTabs />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="ok" className="mb-4">
          {notice}
        </Alert>
      )}

      <div className="panel mb-8 p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-heading text-lg font-semibold">Plan actual: {subscription.plan.name}</span>
          <Badge tone={STATUS_TONE[subscription.status]} dot>
            {STATUS_LABEL[subscription.status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Sucursales: <span className="tabular">{subscription.usage.branches} / {subscription.usage.maxBranches}</span>
        </p>
        {subscription.trialEndsAt && (
          <p className="text-sm text-muted-foreground">
            Prueba gratuita hasta: {new Date(subscription.trialEndsAt).toLocaleDateString()}
          </p>
        )}
        {subscription.renewalDate && (
          <p className="text-sm text-muted-foreground">
            Renueva: {new Date(subscription.renewalDate).toLocaleDateString()}
          </p>
        )}
      </div>

      {features && (
        <div className="panel mb-8 p-5">
          <h2 className="mb-3 font-heading text-lg font-semibold">Tu plan incluye</h2>
          <ul className="space-y-2 text-sm">
            {PLAN_FEATURE_ROWS.map(({ key, label }) => {
              const on = features[key];
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {on ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                      <X className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className={on ? '' : 'text-muted-foreground'}>{label}</span>
                  </span>
                  <Badge tone={on ? 'ok' : 'neutral'}>{on ? 'Incluido' : 'No disponible'}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <h2 className="mb-3 font-heading text-lg font-semibold">Planes disponibles</h2>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.id === subscription.planId;
          return (
            <div key={plan.id} className={`card flex flex-col p-5 ${isCurrent ? 'border-primary bg-primary/5' : ''}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-heading text-lg font-semibold">{plan.name}</span>
                {isCurrent && <Badge tone="primary">Tu plan</Badge>}
              </div>
              <p className="mb-3 font-heading text-2xl">
                <span className="tabular">${plan.priceMonthly}</span>
                <span className="text-sm font-normal text-muted-foreground"> /mes</span>
              </p>
              <ul className="mb-4 space-y-1 text-sm text-muted-foreground">
                <li>Hasta {plan.limits.maxBranches} sucursal(es)</li>
                <li>Hasta {plan.limits.maxUsers} usuarios</li>
                <li>{plan.features.delivery ? 'Delivery incluido' : 'Sin delivery'}</li>
                <li>{plan.features.whatsapp ? 'WhatsApp incluido' : 'Sin WhatsApp'}</li>
              </ul>
              <button
                disabled={isCurrent || pendingPlanId === plan.id}
                onClick={() => onChoosePlan(plan)}
                className={`btn mt-auto w-full ${isCurrent ? '' : 'btn-primary'}`}
              >
                {isCurrent && <Check className="h-4 w-4" />}
                {isCurrent ? 'Plan actual' : pendingPlanId === plan.id ? 'Procesando...' : 'Elegir este plan'}
              </button>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 font-heading text-lg font-semibold">Historial de facturas</h2>
      <ul className="space-y-2">
        {invoices.map((inv) => (
          <li key={inv.id} className="card flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span>
              <span className="font-medium text-foreground">{inv.plan.name}</span>
              <span className="text-muted-foreground"> · {new Date(inv.createdAt).toLocaleDateString()}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular">
                {inv.currency} {inv.amount}
              </span>
              <Badge tone={INVOICE_TONE[inv.status]}>{inv.status}</Badge>
            </span>
          </li>
        ))}
      </ul>
      {invoices.length === 0 && (
        <EmptyState
          icon={FileText}
          title="Todavía no hay facturas"
          description="Cuando arranque tu primer cobro, vas a encontrar acá el detalle de cada mes."
        />
      )}
    </div>
  );
}
