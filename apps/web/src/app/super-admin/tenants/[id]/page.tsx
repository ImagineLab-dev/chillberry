'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Ban, PlayCircle, Store } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, PageHeader, Skeleton } from '@/components/ui';
import {
  INVOICE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  formatDate,
  planPrice,
  type PlanRef,
  type TenantDetail,
} from '../../_shared';

type ApiErrorDetail = {
  code?: string;
  message?: string;
  exceeded?: Array<{ resource: string; current: number; limit: number }>;
};

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-heading text-2xl tabular">{value}</div>
    </div>
  );
}

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<PlanRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limitError, setLimitError] = useState<ApiErrorDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [planReason, setPlanReason] = useState('');

  // Confirmación de suspensión: es destructiva para el negocio del cliente
  // (le corta el servicio), así que no alcanza con un botón — hay que escribir
  // el motivo y confirmar en un paso aparte.
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, p] = await Promise.all([
        api.get<TenantDetail>(`/super-admin/tenants/${id}`),
        // El catálogo de planes es global (no tenant-scoped), así que no hace
        // falta duplicarlo en el módulo de super-admin. `/billing/plans`
        // incluye SUPER_ADMIN en su @Roles justamente por este caller.
        api.get<PlanRef[]>('/billing/plans'),
      ]);
      setTenant(t);
      setPlans(p);
      setSelectedPlanId(t.subscription?.plan.id ?? '');
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onChangePlan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLimitError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.patch(`/super-admin/tenants/${id}/plan`, {
        planId: selectedPlanId,
        reason: planReason.trim() || undefined,
      });
      setNotice('Plan actualizado.');
      setPlanReason('');
      await load();
    } catch (err) {
      const apiErr = err as ApiError;
      const detail = apiErr.detail as ApiErrorDetail | undefined;
      // El 409 de límite trae `exceeded` con qué recurso se pasa y por cuánto:
      // se muestra entero en vez de un "error 409" que no le sirve a nadie.
      if (detail?.code === 'PLAN_LIMIT_EXCEEDED') setLimitError(detail);
      else setError(apiErr.message);
    } finally {
      setSaving(false);
    }
  }

  async function onSuspend() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.patch(`/super-admin/tenants/${id}/subscription`, {
        status: 'SUSPENDED',
        reason: suspendReason.trim(),
      });
      setNotice('Suscripción suspendida.');
      setConfirmSuspend(false);
      setSuspendReason('');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  async function onReactivate() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await api.patch(`/super-admin/tenants/${id}/subscription`, { status: 'ACTIVE' });
      setNotice('Suscripción reactivada.');
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  if (!tenant) {
    return (
      <div>
        <Link href="/super-admin/tenants" className="btn btn-ghost btn-sm mb-4">
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
        {error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-64 w-full" />}
      </div>
    );
  }

  const sub = tenant.subscription;
  const isSuspended = sub?.status === 'SUSPENDED';

  return (
    <div>
      <Link href="/super-admin/tenants" className="btn btn-ghost btn-sm mb-4">
        <ArrowLeft className="h-4 w-4" />
        Volver a tenants
      </Link>

      <PageHeader
        title={tenant.name}
        description={`${tenant.slug} · ${tenant.countryCode} · opera en ${tenant.currency} · alta ${formatDate(tenant.createdAt)}`}
        actions={
          sub ? (
            <Badge tone={STATUS_TONE[sub.status]} dot>
              {STATUS_LABEL[sub.status]}
            </Badge>
          ) : (
            <Badge tone="neutral">Sin suscripción</Badge>
          )
        }
      />

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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sucursales" value={tenant.usage.branches} />
        <Stat label="Usuarios" value={tenant.usage.users} />
        <Stat label="Pedidos totales" value={tenant.usage.orders} />
        <Stat
          label="Suscripción"
          value={sub ? <span className="text-base">{planPrice(sub.plan.priceMonthly, sub.plan.currency)}/mes</span> : '—'}
        />
      </div>

      {!sub && (
        <Alert tone="warn" className="mb-6">
          Este tenant no tiene suscripción — se crea al registrarse por <code>/auth/register</code>. No se le puede
          cambiar el plan ni suspenderlo hasta que tenga una.
        </Alert>
      )}

      {sub && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {/* --------------------------------------------------- cambiar plan */}
          <form onSubmit={onChangePlan} className="panel p-5">
            <h2 className="mb-1 font-heading text-lg font-semibold">Plan</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Plan actual: <span className="font-medium text-foreground">{sub.plan.name}</span>
              {sub.plan.limits && (
                <>
                  {' '}— hasta <span className="tabular">{sub.plan.limits.maxBranches}</span> sucursal(es) y{' '}
                  <span className="tabular">{sub.plan.limits.maxUsers}</span> usuarios.
                </>
              )}
            </p>

            {limitError && (
              <Alert tone="error" className="mb-3">
                <div className="font-medium">{limitError.message}</div>
                {limitError.exceeded && (
                  <ul className="mt-1 list-inside list-disc">
                    {limitError.exceeded.map((e) => (
                      <li key={e.resource} className="tabular">
                        {e.resource}: {e.current} en uso, el plan permite {e.limit}
                      </li>
                    ))}
                  </ul>
                )}
              </Alert>
            )}

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="label" htmlFor="plan">
                  Cambiar a
                </label>
                <select
                  id="plan"
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="input w-full"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {planPrice(p.priceMonthly, p.currency)}/mes
                      {p.id === sub.plan.id ? ' (actual)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="label" htmlFor="planReason">
                  Motivo <span className="font-normal text-muted-foreground">(opcional, queda en la auditoría)</span>
                </label>
                <input
                  id="planReason"
                  value={planReason}
                  onChange={(e) => setPlanReason(e.target.value)}
                  maxLength={300}
                  placeholder="Ej: el cliente pidió bajar de plan"
                  className="input w-full"
                />
              </div>

              <button
                type="submit"
                disabled={saving || selectedPlanId === sub.plan.id}
                className="btn btn-primary w-full"
              >
                {saving ? 'Guardando...' : 'Cambiar plan'}
              </button>
            </div>
          </form>

          {/* ------------------------------------------- suspender / reactivar */}
          <div className="panel p-5">
            <h2 className="mb-1 font-heading text-lg font-semibold">Estado del servicio</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {isSuspended
                ? 'La suscripción está suspendida. Reactivala para que el restaurante vuelva a operar.'
                : 'Suspender le corta el servicio al restaurante. Usalo solo con un motivo concreto.'}
            </p>

            <dl className="mb-4 space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Prueba hasta</dt>
                <dd className="tabular">{formatDate(sub.trialEndsAt)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Renueva</dt>
                <dd className="tabular">{formatDate(sub.renewalDate)}</dd>
              </div>
              {sub.pendingPlan && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Plan pendiente</dt>
                  <dd>{sub.pendingPlan.name}</dd>
                </div>
              )}
            </dl>

            {isSuspended ? (
              <button onClick={onReactivate} disabled={saving} className="btn btn-primary w-full">
                <PlayCircle className="h-4 w-4" />
                {saving ? 'Reactivando...' : 'Reactivar suscripción'}
              </button>
            ) : !confirmSuspend ? (
              <button onClick={() => setConfirmSuspend(true)} disabled={saving} className="btn btn-danger w-full">
                <Ban className="h-4 w-4" />
                Suspender suscripción
              </button>
            ) : (
              // Paso de confirmación explícito: el motivo es obligatorio (el
              // backend lo exige) y el botón de confirmar arranca deshabilitado
              // hasta que haya uno escrito.
              <div className="space-y-3 rounded-md border border-error/30 bg-error/5 p-3">
                <Alert tone="warn">
                  Vas a suspender el servicio de <span className="font-medium">{tenant.name}</span>. El restaurante deja
                  de operar hasta que lo reactives.
                </Alert>
                <div className="space-y-1.5">
                  <label className="label" htmlFor="suspendReason">
                    Motivo de la suspensión <span className="text-error">*</span>
                  </label>
                  <input
                    id="suspendReason"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    maxLength={300}
                    required
                    autoFocus
                    placeholder="Ej: falta de pago — 3 facturas vencidas"
                    className="input w-full"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={onSuspend}
                    disabled={saving || suspendReason.trim().length === 0}
                    className="btn btn-danger flex-1"
                  >
                    {saving ? 'Suspendiendo...' : 'Sí, suspender'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmSuspend(false);
                      setSuspendReason('');
                    }}
                    disabled={saving}
                    className="btn flex-1"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------ restaurantes y sucursales */}
      <h2 className="mb-3 font-heading text-lg font-semibold">Restaurantes y sucursales</h2>
      {tenant.restaurants.length === 0 ? (
        <p className="mb-6 text-sm text-muted-foreground">Todavía no cargó ningún restaurante.</p>
      ) : (
        <ul className="mb-6 space-y-2">
          {tenant.restaurants.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-heading font-medium">{r.name}</span>
                <Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'Activo' : 'Inactivo'}</Badge>
              </div>
              {r.branches.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin sucursales.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {r.branches.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-1">
                      <span className="min-w-0 break-words">
                        <span className="font-medium text-foreground">{b.name}</span>{' '}
                        <span className="text-muted-foreground">— {b.address}</span>
                      </span>
                      <Badge tone={b.active ? 'ok' : 'neutral'}>{b.active ? 'Activa' : 'Inactiva'}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------- últimas facturas */}
      <h2 className="mb-3 font-heading text-lg font-semibold">Últimas facturas</h2>
      {tenant.invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este tenant todavía no tiene facturas de suscripción.</p>
      ) : (
        <ul className="space-y-2">
          {tenant.invoices.map((inv) => (
            <li key={inv.id} className="card flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{inv.plan.name}</span>
                <span className="text-muted-foreground">
                  {' '}· {formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular">{planPrice(inv.amount, inv.currency)}</span>
                <Badge tone={INVOICE_TONE[inv.status]}>{inv.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
