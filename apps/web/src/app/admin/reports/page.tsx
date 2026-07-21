'use client';

import { AyudaSeccion } from '@/components/ayuda-seccion';
import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CreditCard,
  Banknote,
  Clock,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Coins,
  Download,
  FileText,
  Store,
  Users,
} from 'lucide-react';
import { downloadReportCsv, printReportPdf } from '@/lib/report-export';
import { api, type ApiError } from '@/lib/api-client';
import { formatMoney } from '@chillberry/domain';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { AnalyticsTabs } from '@/components/analytics-tabs';

const FALLBACK_COUNTRY_CODE = 'PY';

type Branch = { id: string; name: string };
type TenantSettings = { countryCode: string };
type SalesReport = {
  summary: {
    orders: number;
    revenue: number;
    avgTicket: number;
    itemsSold: number;
    // Margen total del rango — solo cuenta productos con costo cargado.
    margin: number;
    // Cuántos productos vendidos NO tienen costo cargado (su margen no entra).
    productsWithoutCost: number;
  };
  byDay: { date: string; revenue: number; orders: number }[];
  byHour: { hour: number; revenue: number; orders: number }[];
  byPaymentMethod: { method: string; amount: number; count: number }[];
  // Ventas por mozo (no propinas): revenue/orders/ticket atribuidos a cada uno.
  byWaiter: { waiterId: string | null; waiterName: string; orders: number; revenue: number; avgTicket: number }[];
  // Desglose por sucursal — sólo presente en el reporte consolidado (sin filtro
  // de sucursal). `undefined` cuando se filtró una puntual.
  byBranch?: { branchId: string; branchName: string; orders: number; revenue: number }[];
  // Comparación con el período anterior de igual largo — sólo con rango (from+to).
  comparison?: {
    previousRevenue: number;
    previousOrders: number;
    revenueDeltaPct: number | null;
    ordersDeltaPct: number | null;
  };
  // `margin: null` = algún costo sin cargar en ese producto.
  topByRevenue: { name: string; quantity: number; revenue: number; margin: number | null }[];
  topByQuantity: { name: string; quantity: number; revenue: number; margin: number | null }[];
  // Top por rentabilidad — acá el margen NUNCA es null (backend ya filtra).
  topByMargin: { name: string; quantity: number; revenue: number; margin: number }[];
};

/** Propinas por mozo en el rango — para liquidar el turno. Shape exacto de
 *  `PosService.tipsReport`: `byWaiter` incluye la fila "Sin asignar"
 *  (pedidos self-service por QR, `waiterId: null`) y un total general. */
type TipsReport = {
  total: number;
  byWaiter: { waiterId: string | null; waiterName: string; total: number; count: number }[];
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  QR: 'QR',
  WALLET: 'Billetera',
};

/** ISO YYYY-MM-DD del día local — para el filtro "Hoy". */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-07-17" → "17 jul". Se arma desde las partes para no correrse un día
 *  por timezone (la clave `byDay.date` ya viene como YYYY-MM-DD del backend). */
function formatDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('es-PY', { day: '2-digit', month: 'short' });
}

export default function ReportsPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [countryCode, setCountryCode] = useState(FALLBACK_COUNTRY_CODE);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<SalesReport | null>(null);
  const [tips, setTips] = useState<TipsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Branch[]>('/branches')
      .then((b) => {
        setBranches(b);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch((err) => setError((err as ApiError).message));
    api
      .get<TenantSettings>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    // branchId '' = "Todas las sucursales" (consolidado): no se manda el filtro.
    setLoading(true);
    setError(null);
    const query: Record<string, string> = {};
    if (branchId) query.branchId = branchId;
    // El filtro es por día; `to` se extiende al final del día para incluirlo.
    if (from) query.from = new Date(`${from}T00:00:00`).toISOString();
    if (to) query.to = new Date(`${to}T23:59:59`).toISOString();
    // Ventas y propinas comparten los mismos filtros (sucursal + rango), pero se
    // resuelven por separado (`allSettled`): el reporte de ventas es la
    // funcionalidad principal y no debe ocultarse si `/pos/tips` falla. Si fallan
    // las ventas, mostramos el error; si fallan sólo las propinas, la sección de
    // propinas queda ausente y el resto sigue funcionando.
    Promise.allSettled([
      api.get<SalesReport>('/reports/sales', { query }),
      api.get<TipsReport>('/pos/tips', { query }),
    ])
      .then(([salesRes, tipsRes]) => {
        if (salesRes.status === 'fulfilled') {
          setReport(salesRes.value);
        } else {
          setError((salesRes.reason as ApiError).message);
        }
        setTips(tipsRes.status === 'fulfilled' ? tipsRes.value : null);
      })
      .finally(() => setLoading(false));
  }, [branchId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const maxHourOrders = report ? Math.max(1, ...report.byHour.map((h) => h.orders)) : 1;
  const maxDayRevenue = report ? Math.max(1, ...report.byDay.map((d) => d.revenue)) : 1;
  // Etiqueta de sucursal para exports/encabezado — '' = consolidado.
  const branchLabel = branchId ? (branches.find((b) => b.id === branchId)?.name ?? '') : 'Todas las sucursales';
  const maxBranchRevenue = report?.byBranch ? Math.max(1, ...report.byBranch.map((b) => b.revenue)) : 1;
  const maxWaiterRevenue = report ? Math.max(1, ...report.byWaiter.map((w) => w.revenue)) : 1;

  return (
    <div>
      <PageHeader title="Análisis" description="Qué se vende, cuándo y cuánto entra de verdad." />

      <AyudaSeccion id="reports" titulo="Los números del negocio">
        <p>Ventas, márgenes y lo que más sale. Se arman solos con lo que cobra la caja.</p>
        <p>Si algo aparece en cero, casi siempre es que todavía no hay ventas cargadas en ese período.</p>
      </AyudaSeccion>

      <AnalyticsTabs />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="label" htmlFor="rep-branch">
            Sucursal
          </label>
          <select
            id="rep-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="input w-full sm:w-52"
          >
            {/* Consolidado de todas las sucursales — sólo tiene sentido con más
                de una, pero se muestra siempre por simplicidad. */}
            {branches.length > 1 && <option value="">Todas las sucursales</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="label" htmlFor="rep-from">
            Desde
          </label>
          <input
            id="rep-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input w-full sm:w-44"
          />
        </div>
        <div className="space-y-1.5">
          <label className="label" htmlFor="rep-to">
            Hasta
          </label>
          <input
            id="rep-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input w-full sm:w-44"
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setFrom(todayIso());
            setTo(todayIso());
          }}
          className="btn"
        >
          Hoy
        </button>
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
            className="btn btn-ghost"
          >
            Todo
          </button>
        )}
        {report && (
          <>
            <button
              type="button"
              onClick={() =>
                downloadReportCsv(report, tips, {
                  branchName: branchLabel,
                  from,
                  to,
                  countryCode,
                })
              }
              className="btn"
            >
              <Download className="h-4 w-4" />
              CSV
            </button>
            <button
              type="button"
              onClick={() =>
                printReportPdf(report, tips, {
                  branchName: branchLabel,
                  from,
                  to,
                  countryCode,
                })
              }
              className="btn"
            >
              <FileText className="h-4 w-4" />
              PDF
            </button>
          </>
        )}
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}

      {!loading && report && report.summary.orders === 0 && (
        <EmptyState
          icon={BarChart3}
          title="No hay ventas en este rango"
          description="Cuando se cobren pedidos en esta sucursal, vas a ver acá cuánto entró, qué se vendió y a qué hora."
        />
      )}

      {!loading && report && report.summary.orders > 0 && (
        <div className="space-y-6">
          {/* Tarjetas de resumen — el número grande primero. Margen va pegado a
              Facturado: el contraste entre lo que entra y lo que queda es el dato. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <StatCard
              icon={TrendingUp}
              label="Facturado"
              sub={report.comparison ? <DeltaChip pct={report.comparison.revenueDeltaPct} /> : undefined}
            >
              {formatMoney(report.summary.revenue, countryCode)}
            </StatCard>
            <StatCard icon={PiggyBank} label="Margen">
              {formatMoney(report.summary.margin, countryCode)}
            </StatCard>
            <StatCard
              icon={BarChart3}
              label="Pedidos cobrados"
              sub={report.comparison ? <DeltaChip pct={report.comparison.ordersDeltaPct} /> : undefined}
            >
              {report.summary.orders.toLocaleString('es-PY')}
            </StatCard>
            <StatCard icon={CreditCard} label="Ticket promedio">
              {formatMoney(report.summary.avgTicket, countryCode)}
            </StatCard>
            <StatCard icon={Banknote} label="Productos vendidos">
              {report.summary.itemsSold.toLocaleString('es-PY')}
            </StatCard>
          </div>

          {report.summary.productsWithoutCost > 0 && (
            <Alert tone="warn">
              {report.summary.productsWithoutCost === 1
                ? '1 producto vendido no tiene costo cargado — su margen no se cuenta acá. Cargalo en Menú.'
                : `${report.summary.productsWithoutCost} productos vendidos no tienen costo cargado — su margen no se cuenta acá. Cargalos en Menú.`}
            </Alert>
          )}

          {/* Consolidado por sucursal — sólo en el reporte "Todas las sucursales".
              Es el número que el dueño multi-local mira primero: quién factura más. */}
          {report.byBranch && report.byBranch.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <Store className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Ventas por sucursal
              </h2>
              <div className="space-y-2">
                {report.byBranch.map((b) => (
                  <div key={b.branchId} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{b.branchName}</span>
                    <div className="hidden h-4 w-32 overflow-hidden rounded-full bg-muted sm:block">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(b.revenue / maxBranchRevenue) * 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{b.orders} ped.</span>
                    <span className="tabular w-28 shrink-0 text-right font-medium">
                      {formatMoney(b.revenue, countryCode)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Productos que MÁS PLATA dejan (no los más vendidos). */}
            <section className="card p-5">
              <h2 className="mb-4 font-heading text-lg font-semibold">Lo que más factura</h2>
              <ul className="space-y-2">
                {report.topByRevenue.map((p, i) => (
                  <li key={p.name} className="flex items-center gap-3 text-sm">
                    <span className="tabular w-5 shrink-0 text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">×{p.quantity}</span>
                    <span className="tabular shrink-0 font-medium">{formatMoney(p.revenue, countryCode)}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Rentabilidad — lo que más DEJA (margen), no lo que más factura. El
                contraste con la lista de al lado es justo el insight. */}
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <PiggyBank className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Lo que más deja
              </h2>
              {report.topByMargin.length > 0 ? (
                <ul className="space-y-2">
                  {report.topByMargin.map((p, i) => {
                    const pct = p.revenue > 0 ? Math.round((p.margin / p.revenue) * 100) : null;
                    return (
                      <li key={p.name} className="flex items-center gap-3 text-sm">
                        <span className="tabular w-5 shrink-0 text-muted-foreground">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {pct !== null && (
                          <span className="tabular shrink-0 text-xs text-muted-foreground">{pct}%</span>
                        )}
                        <span className="tabular shrink-0 font-medium">{formatMoney(p.margin, countryCode)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Cargá el costo de tus productos en Menú para ver cuáles dejan más ganancia.
                </p>
              )}
            </section>

            {/* Los más pedidos por cantidad — a veces distintos de los que más facturan. */}
            <section className="card p-5">
              <h2 className="mb-4 font-heading text-lg font-semibold">Lo más pedido</h2>
              <ul className="space-y-2">
                {report.topByQuantity.map((p, i) => (
                  <li key={p.name} className="flex items-center gap-3 text-sm">
                    <span className="tabular w-5 shrink-0 text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="tabular shrink-0 font-medium">×{p.quantity}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Medios de pago. */}
            <section className="card p-5">
              <h2 className="mb-4 font-heading text-lg font-semibold">Por medio de pago</h2>
              <ul className="space-y-2">
                {report.byPaymentMethod.map((p) => (
                  <li key={p.method} className="flex items-center justify-between gap-3 text-sm">
                    <span>{PAYMENT_LABEL[p.method] ?? p.method}</span>
                    <span className="text-xs text-muted-foreground">{p.count} pagos</span>
                    <span className="tabular font-medium">{formatMoney(p.amount, countryCode)}</span>
                  </li>
                ))}
                {report.byPaymentMethod.length === 0 && (
                  <li className="text-sm text-muted-foreground">Sin pagos registrados.</li>
                )}
              </ul>
            </section>

            {/* Horas pico — barras con divs, sin librería de charts. */}
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <Clock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Horas pico
              </h2>
              <div className="space-y-1">
                {report.byHour
                  .filter((h) => h.orders > 0)
                  .map((h) => (
                    <div key={h.hour} className="flex items-center gap-2 text-xs">
                      <span className="tabular w-10 shrink-0 text-muted-foreground">{h.hour}:00</span>
                      <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(h.orders / maxHourOrders) * 100}%` }}
                        />
                      </div>
                      <span className="tabular w-6 shrink-0 text-right text-muted-foreground">{h.orders}</span>
                    </div>
                  ))}
              </div>
            </section>

            {/* Ventas por día — misma barra inline que Horas pico, pero por
                facturación diaria en el rango elegido (dato `byDay` que el
                backend ya devolvía y no se dibujaba). */}
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <TrendingUp className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Ventas por día
              </h2>
              {report.byDay.length > 0 ? (
                <div className="space-y-1">
                  {report.byDay.map((d) => (
                    <div key={d.date} className="flex items-center gap-2 text-xs">
                      <span className="tabular w-14 shrink-0 text-muted-foreground">{formatDayLabel(d.date)}</span>
                      <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(d.revenue / maxDayRevenue) * 100}%` }}
                        />
                      </div>
                      <span className="tabular shrink-0 text-right text-muted-foreground">
                        {formatMoney(d.revenue, countryCode)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sin ventas en el rango.</p>
              )}
            </section>
          </div>

          {/* Ventas por mesero — cuánto facturó cada uno (distinto de propinas).
              La fila "Sin asignar (QR)" son los pedidos self-service sin mozo. */}
          {report.byWaiter.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Ventas por mesero
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Mesero</th>
                      <th className="pb-2 text-right font-medium">Facturado</th>
                      <th className="pb-2 text-right font-medium">Pedidos</th>
                      <th className="pb-2 text-right font-medium">Ticket prom.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byWaiter.map((w) => (
                      <tr
                        key={w.waiterId ?? 'unassigned'}
                        className={`border-b border-border/60 ${w.waiterId ? '' : 'text-muted-foreground'}`}
                      >
                        <td className="flex items-center gap-2 py-2">
                          <span className="hidden h-3 w-16 overflow-hidden rounded-full bg-muted sm:block">
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${(w.revenue / maxWaiterRevenue) * 100}%` }}
                            />
                          </span>
                          {w.waiterName}
                        </td>
                        <td className="tabular py-2 text-right font-medium">{formatMoney(w.revenue, countryCode)}</td>
                        <td className="tabular py-2 text-right text-muted-foreground">{w.orders}</td>
                        <td className="tabular py-2 text-right text-muted-foreground">
                          {formatMoney(w.avgTicket, countryCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Propinas por mesero — para liquidar el turno. La fila "Sin asignar"
              (pedidos self-service por QR) y el total general vienen del backend. */}
          {tips && (
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <Coins className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Propinas por mesero
              </h2>
              {tips.byWaiter.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Mesero</th>
                        <th className="pb-2 text-right font-medium">Propinas</th>
                        <th className="pb-2 text-right font-medium">Pagos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tips.byWaiter.map((w) => (
                        <tr
                          key={w.waiterId ?? 'unassigned'}
                          className={`border-b border-border/60 ${w.waiterId ? '' : 'text-muted-foreground'}`}
                        >
                          <td className="py-2">{w.waiterName}</td>
                          <td className="tabular py-2 text-right font-medium">{formatMoney(w.total, countryCode)}</td>
                          <td className="tabular py-2 text-right text-muted-foreground">{w.count}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-medium">
                        <td className="pt-2">Total</td>
                        <td className="tabular pt-2 text-right">{formatMoney(tips.total, countryCode)}</td>
                        <td className="pt-2 text-right" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No se registraron propinas en este rango.</p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  children,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  /** Línea chica debajo del número — ej. el delta vs período anterior. */
  sub?: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="tabular font-heading text-2xl font-semibold">{children}</p>
      {sub && <div className="mt-1.5">{sub}</div>}
    </div>
  );
}

/** Chip de variación porcentual ▲/▼ (verde sube, rojo baja). null → nada. */
function DeltaChip({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${up ? 'text-ok-foreground' : 'text-error-foreground'}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? '+' : ''}
      {pct}% vs período anterior
    </span>
  );
}
