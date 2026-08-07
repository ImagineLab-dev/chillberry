'use client';

import { PrimerosPasos } from '@/components/primeros-pasos';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bike,
  CreditCard,
  Package,
  QrCode,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { getCurrentUser, type MeResponse } from '@/lib/auth';
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui';

// Fallback mientras `/tenant-settings` todavía no respondió (ver useEffect) —
// no debe llegar `undefined` a formatMoney.
const FALLBACK_COUNTRY_CODE = 'PY';

type TenantSettings = { id: string; name: string; countryCode: string; currency: string; timezone: string };

type TableCounts = { AVAILABLE: number; OCCUPIED: number; RESERVED: number; total: number };

type SubscriptionSummary = {
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';
  plan: string;
  planCode: string;
  usage: { branches: number; maxBranches: number };
};

type LowStockItem = { id: string; name: string; unit: string; stockQty: number; lowStockAt: number };

type DashboardSummary = {
  todayOrders: number;
  todayRevenue: number;
  yesterdayRevenue: number;
  last7Days: { date: string; revenue: number }[];
  tables: TableCounts;
  todayReservations: number;
  pendingDeliveries: number;
  alerts: {
    unassignedDeliveries: number;
    staleCashSessions: number;
    lowStock: { count: number; items: LowStockItem[] };
  };
  subscription: SubscriptionSummary;
};

const SUB_STATUS_TONE: Record<SubscriptionSummary['status'], Tone> = {
  ACTIVE: 'ok',
  TRIAL: 'warn',
  PAST_DUE: 'error',
  SUSPENDED: 'error',
  CANCELLED: 'error',
};

const SUB_STATUS_LABEL: Record<SubscriptionSummary['status'], string> = {
  ACTIVE: 'Activo',
  TRIAL: 'Prueba gratuita',
  PAST_DUE: 'Pago pendiente',
  SUSPENDED: 'Suspendido',
  CANCELLED: 'Cancelado',
};

const QUICK_ACTIONS = [
  { href: '/admin/orders', label: 'Ver pedidos', icon: ReceiptText },
  { href: '/admin/menu', label: 'Gestionar menú', icon: UtensilsCrossed },
  { href: '/admin/tables', label: 'Ver mesas', icon: QrCode },
  { href: '/admin/billing', label: 'Facturación', icon: CreditCard },
];

function formatNumber(value: number) {
  return Number(value).toLocaleString('es-PY');
}

// Pluralización real: "1 delivery" / "2 deliveries". El "(s)" de máquina leía
// como placeholder de programador y contradecía la voz cuidada del resto.
function plural(n: number, singular: string, pluralForm: string) {
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Tarjeta de métrica: número grande en `foreground`; el color queda para el
 *  ícono/badge, que es donde comunica estado. */
function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  children,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: Tone;
  children?: React.ReactNode;
}) {
  const iconTone =
    tone === 'primary'
      ? 'bg-primary/15 text-primary'
      : tone === 'ok'
        ? 'bg-ok/15 text-ok-foreground'
        : tone === 'warn'
          ? 'bg-warn/15 text-warn-foreground'
          : 'bg-muted text-muted-foreground';

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconTone}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="tabular font-heading text-3xl font-semibold text-foreground">{value}</p>
      {children}
    </div>
  );
}

export default function DashboardPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser().then(setMe).catch(() => {});
    api
      .get<TenantSettings>('/tenant-settings')
      .then(setTenantSettings)
      .catch(() => {});
    api
      .get<DashboardSummary>('/dashboard/summary')
      .then(setSummary)
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, []);

  const countryCode = tenantSettings?.countryCode ?? FALLBACK_COUNTRY_CODE;
  const firstName = me?.name?.split(' ')[0];

  // Delta de ingresos hoy vs ayer (para la flecha ▲/▼). Si ayer fue 0 no se
  // muestra porcentaje (dividir por 0 no dice nada útil).
  const revenueDeltaPct =
    summary && summary.yesterdayRevenue > 0
      ? Math.round(((summary.todayRevenue - summary.yesterdayRevenue) / summary.yesterdayRevenue) * 100)
      : null;
  const maxDayRevenue = summary ? Math.max(1, ...summary.last7Days.map((d) => d.revenue)) : 1;
  // ¿Hubo alguna venta en la ventana de 7 días? Si no, el gráfico va a un estado
  // vacío con voz, en vez de 7 barras de 2px que parecen un gráfico roto.
  const hasWeekRevenue = summary ? summary.last7Days.some((d) => d.revenue > 0) : false;
  const alerts = summary?.alerts;
  const hasAlerts =
    !!alerts && (alerts.unassignedDeliveries > 0 || alerts.staleCashSessions > 0 || alerts.lowStock.count > 0);
  // "Al límite" (rojo) sólo si REALMENTE se pasó del cupo (raro). Usar el cupo
  // incluido del plan (p. ej. 1/1 en Starter) es lo normal, no un problema: eso
  // va en tono neutro. Gastar el rojo en un no-problema lo vacía de significado
  // y grita más fuerte que la tarea operativa real de arriba.
  const isOverBranchLimit = summary
    ? summary.subscription.usage.branches > summary.subscription.usage.maxBranches
    : false;
  const isAtBranchCapacity = summary
    ? summary.subscription.usage.branches >= summary.subscription.usage.maxBranches
    : false;
  const branchUsagePct = summary
    ? Math.min(100, Math.round((summary.subscription.usage.branches / Math.max(1, summary.subscription.usage.maxBranches)) * 100))
    : 0;

  return (
    <div>
      <PageHeader
        title={`Hola${firstName ? `, ${firstName}` : ''}`}
        description="Este es el resumen de hoy en tu restaurante."
      />

      {/* Va arriba del resumen a propósito: si al restaurante todavía le falta
          cargar la carta o las mesas, los números de abajo van a estar en cero
          y lo útil es decir qué hacer, no mostrar ceros. */}
      <PrimerosPasos />

      {error && <Alert tone="error" className="mb-6">No pudimos cargar el resumen: {error}</Alert>}

      {loading && (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}

      {!loading && summary && (
        <>
          {/* Alertas operativas — sólo aparece si hay algo que requiere acción.
              Cada fila linkea a la pantalla donde se resuelve. */}
          {hasAlerts && alerts && (
            <div className="card mb-6 border-warn/40 bg-warn/5 p-5">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-warn-foreground" aria-hidden="true" />
                <h2 className="font-heading text-base font-semibold">Requiere tu atención</h2>
              </div>
              <ul className="space-y-2">
                {alerts.unassignedDeliveries > 0 && (
                  <li>
                    <Link
                      href="/admin/delivery"
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <Bike className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {plural(alerts.unassignedDeliveries, 'delivery', 'deliveries')} sin repartidor asignado
                      </span>
                      <Badge tone="error">Asignar</Badge>
                    </Link>
                  </li>
                )}
                {alerts.staleCashSessions > 0 && (
                  <li>
                    <Link
                      href="/pos"
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {plural(alerts.staleCashSessions, 'caja abierta', 'cajas abiertas')} de un día anterior sin cerrar
                      </span>
                      <Badge tone="warn">Cerrar caja</Badge>
                    </Link>
                  </li>
                )}
                {alerts.lowStock.count > 0 && (
                  <li>
                    <Link
                      href="/admin/inventory"
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {plural(alerts.lowStock.count, 'insumo', 'insumos')} con stock bajo
                        <span className="hidden text-muted-foreground sm:inline">
                          ({alerts.lowStock.items.map((i) => i.name).slice(0, 3).join(', ')}
                          {alerts.lowStock.count > 3 ? '…' : ''})
                        </span>
                      </span>
                      <Badge tone="warn">Reponer</Badge>
                    </Link>
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Pedidos hoy" value={formatNumber(summary.todayOrders)} icon={ReceiptText} />

            <StatCard
              label="Ingresos hoy"
              value={formatMoney(summary.todayRevenue, countryCode)}
              icon={Wallet}
              tone="primary"
            >
              {revenueDeltaPct !== null && (
                <p
                  className={`mt-2 flex items-center gap-1 text-xs font-medium ${
                    revenueDeltaPct >= 0 ? 'text-ok-foreground' : 'text-error-foreground'
                  }`}
                >
                  {revenueDeltaPct >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {revenueDeltaPct >= 0 ? '+' : ''}
                  {revenueDeltaPct}% vs ayer
                </p>
              )}
            </StatCard>

            <div className="card p-5">
              <div className="mb-3 flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">Mesas</span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <QrCode className="h-4 w-4" />
                </span>
              </div>
              <p className="tabular mb-2 font-heading text-3xl font-semibold text-foreground">
                {summary.tables.total}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {/* Ocupada = servicio activo = plata, no un error: violeta de marca
                    (actividad), no rojo. Reservas de hoy (del sistema de reservas,
                    no el RESERVED de la mesa que nada seteaba) = informativo, neutral. */}
                <Badge tone="primary">{plural(summary.tables.OCCUPIED, 'ocupada', 'ocupadas')}</Badge>
                <Badge tone="ok">{plural(summary.tables.AVAILABLE, 'disponible', 'disponibles')}</Badge>
                <Badge tone="neutral">{plural(summary.todayReservations, 'reserva', 'reservas')} hoy</Badge>
              </div>
            </div>

            <StatCard
              label="Deliveries pendientes"
              value={formatNumber(summary.pendingDeliveries)}
              icon={Bike}
              tone={summary.pendingDeliveries > 0 ? 'warn' : 'ok'}
            />
          </div>

          <Link href="/admin/billing" className="card card-interactive mb-8 block p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Tu plan</p>
                <p className="font-heading text-xl font-semibold">{summary.subscription.plan}</p>
              </div>
              <Badge tone={SUB_STATUS_TONE[summary.subscription.status]} dot>
                {SUB_STATUS_LABEL[summary.subscription.status]}
              </Badge>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Sucursales usadas</span>
                <span className={`tabular ${isOverBranchLimit ? 'font-semibold text-error-foreground' : ''}`}>
                  {summary.subscription.usage.branches} / {summary.subscription.usage.maxBranches}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${
                    isOverBranchLimit ? 'bg-error' : isAtBranchCapacity ? 'bg-primary' : 'bg-ok'
                  }`}
                  style={{ width: `${branchUsagePct}%` }}
                />
              </div>
              {isOverBranchLimit ? (
                <p className="mt-2 text-xs font-medium text-error-foreground">
                  Te pasaste del límite de sucursales de tu plan.
                </p>
              ) : isAtBranchCapacity ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Estás usando todas las sucursales de tu plan. Para sumar otra, cambiá de plan.
                </p>
              ) : null}
            </div>
          </Link>

          {/* Mini-tendencia de ingresos, últimos 7 días (en la zona horaria del
              local). Barras con CSS puro — no vale traer una lib de charts para
              un sparkline. El día de hoy va resaltado. */}
          <div className="card mb-8 p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="font-heading text-base font-semibold">Ingresos — últimos 7 días</h2>
              {hasWeekRevenue && <span className="text-xs text-muted-foreground">Zona horaria del local</span>}
            </div>
            {hasWeekRevenue ? (
              // Sin `items-end`: alineaba cada columna al fondo dejándola de altura
              // AUTOMÁTICA, y el `height: %` de la barra no tenía contra qué resolver
              // (se dibujaban en 0). Con el stretch por defecto la columna hereda los
              // 8rem y el `flex-1` del riel le da altura definida a la barra.
              <div className="flex h-32 gap-2">
                {summary.last7Days.map((d, idx) => {
                  const isToday = idx === summary.last7Days.length - 1;
                  const heightPct = Math.max(2, Math.round((d.revenue / maxDayRevenue) * 100));
                  // 'YYYY-MM-DD' → etiqueta de día corta sin parsear a Date.
                  const dayLabel = d.date.slice(8, 10);
                  return (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                      <div className="flex w-full flex-1 items-end" title={formatMoney(d.revenue, countryCode)}>
                        <div
                          className={`w-full rounded-t ${isToday ? 'bg-primary' : 'bg-ok/50'}`}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>
                      <span className={`text-xs ${isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                        {dayLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              // Estado vacío con voz: sin esto, 7 barras de 2px sobre una caja blanca
              // leían como "gráfico roto". Un local que recién arranca ve una
              // explicación, no un artefacto.
              <EmptyState
                icon={TrendingUp}
                title="Todavía no hay ventas esta semana"
                description="Cuando entren pedidos, acá vas a ver la tendencia de tus ingresos, día por día."
                className="py-8"
              />
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-3">
        {QUICK_ACTIONS.map((action) => (
          <Link key={action.href} href={action.href} className="btn">
            <action.icon className="h-4 w-4" />
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
