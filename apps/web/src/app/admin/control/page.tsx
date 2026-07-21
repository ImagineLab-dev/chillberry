'use client';

import { useEffect, useState } from 'react';
import { Ban, Banknote, Calendar, ClipboardList, Percent } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui';
import { AnalyticsTabs } from '@/components/analytics-tabs';

// Fallback mientras `/tenant-settings` todavía no respondió — nunca debe llegar
// `undefined` a formatMoney (mismo criterio que dashboard/orders).
const FALLBACK_COUNTRY_CODE = 'PY';

type Branch = { id: string; name: string };
type TenantSettings = { id: string; name: string; countryCode: string; currency: string; timezone: string };

type Discount = {
  id: string;
  amount: string;
  type: string;
  reason: string | null;
  by: string;
  table: string | null;
  at: string;
};
type Cancellation = {
  id: string;
  total: string;
  reason: string | null;
  by: string;
  table: string | null;
  at: string;
};
type CashMovement = {
  id: string;
  type: 'PAY_IN' | 'PAY_OUT';
  amount: string;
  note: string | null;
  by: string;
  at: string;
};
type ControlReport = { discounts: Discount[]; cancellations: Cancellation[]; cashMovements: CashMovement[] };

// Arqueo = un cierre de caja. `closedAt`/expected/counted/difference vienen null
// mientras la sesión sigue abierta. `cashTips` llega como number; los Decimal
// como string. La lista viene con el más reciente primero.
type CashSessionRow = {
  id: string;
  openedAt: string;
  closedAt: string | null;
  cashierName: string | null;
  openingAmount: string;
  expectedCash: string | null;
  countedCash: string | null;
  difference: string | null;
  cashTips: number;
};

const DISCOUNT_LABEL: Record<string, string> = {
  PERCENTAGE: 'Porcentaje',
  FIXED_AMOUNT: 'Monto fijo',
  COUPON: 'Cupón',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-419', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Fecha de hoy en zona horaria local, en formato `YYYY-MM-DD` para los inputs. */
function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Tinte de la diferencia de arqueo: negativa = faltante (rojo), positiva =
 *  sobrante (verde), cero o sin cierre = neutro. */
function differenceTone(difference: string | null): Tone {
  if (difference == null) return 'neutral';
  const n = Number(difference);
  if (n < 0) return 'error';
  if (n > 0) return 'ok';
  return 'neutral';
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  tone: Tone;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <h2 className="font-heading text-lg font-semibold">{title}</h2>
      <Badge tone={tone}>{count}</Badge>
    </div>
  );
}

/**
 * Fila de un evento auditable — misma anatomía para las tres secciones: monto
 * grande (tabular), un badge que dice qué tipo de evento es, el motivo, y abajo
 * el rastro (responsable / mesa / fecha). Las filas sensibles (anulaciones y
 * retiros de caja) van con tinte `error` suave para que salten a la vista.
 */
function ControlCard({
  sensitive = false,
  amount,
  countryCode,
  badge,
  reason,
  emptyReason,
  by,
  table,
  at,
}: {
  sensitive?: boolean;
  amount: string;
  countryCode: string;
  badge: React.ReactNode;
  reason: string | null;
  emptyReason: string;
  by: string;
  table?: string | null;
  at: string;
}) {
  return (
    <li className={`card card-dense p-4 ${sensitive ? 'border-error/40 bg-error/5' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <span className="tabular font-heading text-lg font-semibold text-foreground">
          {formatMoney(amount, countryCode)}
        </span>
        {badge}
      </div>
      <p className="mt-1.5 text-sm">
        {reason?.trim() ? (
          <span className="text-foreground">{reason}</span>
        ) : (
          <span className="italic text-muted-foreground">{emptyReason}</span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Responsable: <span className="font-medium text-foreground">{by}</span>
        </span>
        {table ? <span>Mesa {table}</span> : null}
        <span className="tabular">{formatDateTime(at)}</span>
      </div>
    </li>
  );
}

export default function ControlPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [countryCode, setCountryCode] = useState(FALLBACK_COUNTRY_CODE);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [data, setData] = useState<ControlReport | null>(null);
  const [arqueos, setArqueos] = useState<CashSessionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Branch[]>('/branches')
      .then((b) => {
        setBranches(b);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch(() => {});
    api
      .get<TenantSettings>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    // Los inputs dan una fecha suelta (`YYYY-MM-DD`). Si la mandáramos tal cual,
    // el backend hace `new Date(to)` → medianoche UTC, que deja AFUERA todo el
    // día. Por eso expandimos el rango a día completo en hora local: `from` al
    // arranque del día, `to` al final, y recién ahí a ISO.
    const fromParam = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
    const toParam = to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined;
    const query = { branchId, from: fromParam, to: toParam };
    // Control y arqueos comparten sucursal + rango, así que se piden juntos.
    // Pero con manejo de error INDEPENDIENTE (`allSettled`): el reporte de
    // control es funcionalidad existente y no debe romperse si el endpoint
    // nuevo `/pos/cash-sessions` todavía no está desplegado. Si el control
    // falla, se muestra el error como antes; si fallan sólo los arqueos, la
    // sección queda vacía y el resto sigue funcionando.
    Promise.allSettled([
      api.get<ControlReport>('/pos/control', { query }),
      api.get<CashSessionRow[]>('/pos/cash-sessions', { query }),
    ])
      .then(([reportRes, sessionsRes]) => {
        if (reportRes.status === 'fulfilled') {
          setData(reportRes.value);
        } else {
          setError((reportRes.reason as ApiError).message);
        }
        setArqueos(sessionsRes.status === 'fulfilled' ? sessionsRes.value : []);
      })
      .finally(() => setLoading(false));
  }, [branchId, from, to]);

  function setToday() {
    const today = todayLocalISODate();
    setFrom(today);
    setTo(today);
  }

  function clearRange() {
    setFrom('');
    setTo('');
  }

  return (
    <div>
      <PageHeader
        title="Control interno"
        description="El rastro de descuentos, anulaciones y movimientos de caja — con quién lo hizo, cuánto y por qué. Para responder de un vistazo: ¿cómo sé que no me roban?"
      />
      <AnalyticsTabs />

      <div className="panel mb-6 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div>
            <label htmlFor="control-branch" className="label mb-1.5">
              Sucursal
            </label>
            <select
              id="control-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="input w-full sm:w-56"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="control-from" className="label mb-1.5">
              Desde
            </label>
            <input
              id="control-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="input w-full sm:w-44"
            />
          </div>

          <div>
            <label htmlFor="control-to" className="label mb-1.5">
              Hasta
            </label>
            <input
              id="control-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="input w-full sm:w-44"
            />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={setToday} className="btn">
              <Calendar className="h-4 w-4" />
              Hoy
            </button>
            <button type="button" onClick={clearRange} disabled={!from && !to} className="btn btn-ghost">
              Ver todo
            </button>
          </div>
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          No pudimos cargar el control: {error}
        </Alert>
      )}

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {!loading && data && (
        <div className="space-y-8">
          {/* Anulaciones — lo más sensible: primero y destacado. */}
          <section>
            <SectionHeader icon={Ban} title="Anulaciones de pedidos" count={data.cancellations.length} tone="error" />
            {data.cancellations.length === 0 ? (
              <EmptyState
                icon={Ban}
                title="Sin anulaciones en este rango"
                description="Ningún pedido fue anulado. Cuando alguien cancele uno, vas a ver acá quién lo hizo, cuánto era y por qué."
              />
            ) : (
              <ul className="space-y-2">
                {data.cancellations.map((c) => (
                  <ControlCard
                    key={c.id}
                    sensitive
                    amount={c.total}
                    countryCode={countryCode}
                    badge={<Badge tone="error">Anulación</Badge>}
                    reason={c.reason}
                    emptyReason="Sin motivo registrado"
                    by={c.by}
                    table={c.table}
                    at={c.at}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Descuentos. */}
          <section>
            <SectionHeader icon={Percent} title="Descuentos aplicados" count={data.discounts.length} tone="warn" />
            {data.discounts.length === 0 ? (
              <EmptyState
                icon={Percent}
                title="Sin descuentos en este rango"
                description="Nadie aplicó descuentos. Cada uno que se cargue va a aparecer acá con el responsable y el motivo."
              />
            ) : (
              <ul className="space-y-2">
                {data.discounts.map((d) => (
                  <ControlCard
                    key={d.id}
                    amount={d.amount}
                    countryCode={countryCode}
                    badge={<Badge tone="warn">{DISCOUNT_LABEL[d.type] ?? d.type}</Badge>}
                    reason={d.reason}
                    emptyReason="Sin motivo registrado"
                    by={d.by}
                    table={d.table}
                    at={d.at}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Movimientos de caja. Los retiros (PAY_OUT) son plata que sale del
              cajón → sensibles, van destacados. Los ingresos (PAY_IN) van neutros. */}
          <section>
            <SectionHeader
              icon={Banknote}
              title="Movimientos de caja"
              count={data.cashMovements.length}
              tone="neutral"
            />
            {data.cashMovements.length === 0 ? (
              <EmptyState
                icon={Banknote}
                title="Sin movimientos de caja en este rango"
                description="No hubo retiros ni ingresos manuales de caja. Los retiros — plata que sale del cajón — se destacan acá cuando ocurren."
              />
            ) : (
              <ul className="space-y-2">
                {data.cashMovements.map((m) => {
                  const isPayOut = m.type === 'PAY_OUT';
                  return (
                    <ControlCard
                      key={m.id}
                      sensitive={isPayOut}
                      amount={m.amount}
                      countryCode={countryCode}
                      badge={
                        <Badge tone={isPayOut ? 'error' : 'info'}>{isPayOut ? 'Retiro' : 'Ingreso'}</Badge>
                      }
                      reason={m.note}
                      emptyReason="Sin nota registrada"
                      by={m.by}
                      at={m.at}
                    />
                  );
                })}
              </ul>
            )}
          </section>

          {/* Arqueos — los cierres de caja del rango. La DIFERENCIA es lo que se
              escanea de un vistazo: negativa = faltante (rojo), positiva =
              sobrante (verde), cero = cuadró. */}
          <section>
            <SectionHeader
              icon={ClipboardList}
              title="Arqueos (cierres de caja)"
              count={(arqueos ?? []).length}
              tone="neutral"
            />
            {(arqueos ?? []).length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="Sin arqueos en este rango"
                description="No se cerró ninguna caja en este período. Cada cierre va a aparecer acá con la apertura, el esperado, lo contado y la diferencia."
              />
            ) : (
              <>
                {/* Escritorio: tabla — se comparan diferencias entre turnos de un
                    vistazo. `overflow-x-auto` para que scrollee sola. */}
                <div className="panel hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th scope="col" className="px-4 py-3 font-medium">Cierre</th>
                        <th scope="col" className="px-4 py-3 font-medium">Cajero</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">Apertura</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">Esperado</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">Contado</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">Diferencia</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">Propinas efvo.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(arqueos ?? []).map((a) => (
                        <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                          <td className="tabular px-4 py-3 text-muted-foreground">
                            {a.closedAt ? formatDateTime(a.closedAt) : <span className="italic">En curso</span>}
                          </td>
                          <td className="px-4 py-3">
                            {a.cashierName ? (
                              <span className="text-foreground">{a.cashierName}</span>
                            ) : (
                              <span className="italic text-muted-foreground">Sin registrar</span>
                            )}
                          </td>
                          <td className="tabular px-4 py-3 text-right">
                            {formatMoney(a.openingAmount, countryCode)}
                          </td>
                          <td className="tabular px-4 py-3 text-right">
                            {a.expectedCash != null ? formatMoney(a.expectedCash, countryCode) : '—'}
                          </td>
                          <td className="tabular px-4 py-3 text-right">
                            {a.countedCash != null ? formatMoney(a.countedCash, countryCode) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {a.difference != null ? (
                              <Badge tone={differenceTone(a.difference)}>
                                {formatMoney(a.difference, countryCode)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="tabular px-4 py-3 text-right">
                            {formatMoney(a.cashTips, countryCode)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Móvil: la misma info como cards apiladas. */}
                <ul className="space-y-2 md:hidden">
                  {(arqueos ?? []).map((a) => (
                    <li key={a.id} className="card card-dense p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="tabular text-xs text-muted-foreground">
                          {a.closedAt ? formatDateTime(a.closedAt) : 'En curso'}
                        </span>
                        {a.difference != null ? (
                          <Badge tone={differenceTone(a.difference)}>
                            Dif. {formatMoney(a.difference, countryCode)}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">Sin cierre</Badge>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm">
                        Cajero:{' '}
                        {a.cashierName ? (
                          <span className="font-medium text-foreground">{a.cashierName}</span>
                        ) : (
                          <span className="italic text-muted-foreground">Sin registrar</span>
                        )}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular">Apertura: {formatMoney(a.openingAmount, countryCode)}</span>
                        <span className="tabular">
                          Esperado: {a.expectedCash != null ? formatMoney(a.expectedCash, countryCode) : '—'}
                        </span>
                        <span className="tabular">
                          Contado: {a.countedCash != null ? formatMoney(a.countedCash, countryCode) : '—'}
                        </span>
                        <span className="tabular">Propinas: {formatMoney(a.cashTips, countryCode)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
