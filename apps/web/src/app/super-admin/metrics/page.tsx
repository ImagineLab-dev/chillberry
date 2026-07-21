'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, PageHeader, Skeleton } from '@/components/ui';
import { formatMoneyByCurrency } from '@chillberry/domain';
import { STATUS_LABEL, STATUS_TONE, formatMonth, planPrice, type Metrics } from '../_shared';

const COUNTRY_NAME: Record<string, string> = {
  PY: 'Paraguay',
  AR: 'Argentina',
  BR: 'Brasil',
  BO: 'Bolivia',
  CL: 'Chile',
  CO: 'Colombia',
  CR: 'Costa Rica',
  DO: 'Rep. Dominicana',
  EC: 'Ecuador',
  SV: 'El Salvador',
  GT: 'Guatemala',
  HN: 'Honduras',
  MX: 'México',
  PA: 'Panamá',
  PE: 'Perú',
  UY: 'Uruguay',
};

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-heading text-2xl tabular">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Barra proporcional simple. Sin librería de gráficos: son 6 barras y una
 *  dependencia nueva no se justifica. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function MetricsPage() {
  const [m, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Metrics>('/super-admin/metrics')
      .then(setMetrics)
      .catch((err) => setError((err as ApiError).message));
  }, []);

  if (!m) {
    return (
      <div>
        <PageHeader title="Métricas" description="Cómo viene el negocio de Chillberry." />
        {error ? <Alert tone="error">{error}</Alert> : <Skeleton className="h-64 w-full" />}
      </div>
    );
  }

  const maxSignup = Math.max(1, ...m.signupsByMonth.map((s) => s.count));
  const maxPlan = Math.max(1, ...m.byPlan.map((p) => p.tenants));
  const maxCountry = Math.max(1, ...m.byCountry.map((c) => c.tenants));
  const statusRows = (['ACTIVE', 'TRIAL', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'] as const).map((s) => ({
    status: s,
    count: m.byStatus[s],
  }));

  return (
    <div>
      <PageHeader title="Métricas" description="Cómo viene el negocio de Chillberry. Todos los números son conteos reales." />

      {/* ------------------------------------------------------------- MRR */}
      <h2 className="mb-3 font-heading text-lg font-semibold">Ingreso mensual recurrente (MRR)</h2>
      <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {m.mrr.length === 0 ? (
          <div className="card p-4 text-sm text-muted-foreground sm:col-span-3">
            Todavía no hay ninguna suscripción activa — el MRR es cero.
          </div>
        ) : (
          m.mrr.map((row) => (
            <Stat
              key={row.currency}
              label={`MRR en ${row.currency}`}
              value={formatMoneyByCurrency(row.amount, row.currency)}
              hint={`${row.tenants} suscripción(es) activa(s)`}
            />
          ))
        )}
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Agrupado por la moneda del <strong>plan</strong>, no la del tenant: lo que Smartia cobra está cotizado en la
        moneda del plan (hoy USD), mientras que cada restaurante opera en la suya (₲, $, R$...). Se muestran separados
        a propósito — sumar montos de distinta moneda daría un número que no significa nada.
      </p>

      {/* --------------------------------------------------------- resumen */}
      <h2 className="mb-3 font-heading text-lg font-semibold">Tenants</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total" value={m.totalTenants} />
        <Stat label="Activos" value={m.byStatus.ACTIVE} hint="pagando" />
        <Stat label="En prueba" value={m.byStatus.TRIAL} hint="trial sin pagar" />
        <Stat label="Suspendidos" value={m.byStatus.SUSPENDED} hint="servicio cortado" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ por estado */}
        <div className="panel p-5">
          <h3 className="mb-3 font-heading font-semibold">Por estado de suscripción</h3>
          <ul className="space-y-2">
            {statusRows.map((row) => (
              <li key={row.status} className="flex items-center justify-between gap-2 text-sm">
                <Badge tone={STATUS_TONE[row.status]} dot>
                  {STATUS_LABEL[row.status]}
                </Badge>
                <span className="tabular">{row.count}</span>
              </li>
            ))}
            {m.byStatus.WITHOUT_SUBSCRIPTION > 0 && (
              <li className="flex items-center justify-between gap-2 border-t border-border pt-2 text-sm">
                <Badge tone="neutral">Sin suscripción</Badge>
                <span className="tabular">{m.byStatus.WITHOUT_SUBSCRIPTION}</span>
              </li>
            )}
          </ul>
          {m.byStatus.WITHOUT_SUBSCRIPTION > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Hay tenants sin ninguna Subscription (creados sin pasar por el registro). Se cuentan aparte para que la
              suma dé el total.
            </p>
          )}
        </div>

        {/* -------------------------------------------------- por plan */}
        <div className="panel p-5">
          <h3 className="mb-3 font-heading font-semibold">Distribución por plan</h3>
          {m.byPlan.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ningún tenant tiene suscripción todavía.</p>
          ) : (
            <ul className="space-y-3">
              {m.byPlan.map((p) => (
                <li key={p.planId}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="font-medium">{p.name}</span>{' '}
                      <span className="text-xs text-muted-foreground tabular">
                        {planPrice(p.priceMonthly, p.currency)}/mes
                      </span>
                    </span>
                    <span className="tabular">{p.tenants}</span>
                  </div>
                  <Bar value={p.tenants} max={maxPlan} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------- altas por mes */}
        <div className="panel p-5">
          <h3 className="mb-3 font-heading font-semibold">Altas por mes</h3>
          <p className="mb-3 text-xs text-muted-foreground">Últimos 6 meses, incluido el actual.</p>
          <ul className="space-y-3">
            {m.signupsByMonth.map((s) => (
              <li key={s.month}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="capitalize">{formatMonth(s.month)}</span>
                  <span className="tabular">{s.count}</span>
                </div>
                <Bar value={s.count} max={maxSignup} />
              </li>
            ))}
          </ul>
        </div>

        {/* ------------------------------------------------ por país */}
        <div className="panel p-5">
          <h3 className="mb-3 font-heading font-semibold">Por país</h3>
          {m.byCountry.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay tenants.</p>
          ) : (
            <ul className="space-y-3">
              {m.byCountry.map((c) => (
                <li key={c.countryCode}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span>{COUNTRY_NAME[c.countryCode] ?? c.countryCode}</span>
                    <span className="tabular">{c.tenants}</span>
                  </div>
                  <Bar value={c.tenants} max={maxCountry} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
