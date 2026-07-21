'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import {
  STATUS_LABEL,
  STATUS_TONE,
  formatDate,
  planPrice,
  type SubscriptionStatus,
  type TenantListItem,
  type TenantsPage,
} from '../_shared';

const STATUS_OPTIONS: Array<{ value: '' | SubscriptionStatus; label: string }> = [
  { value: '', label: 'Todos los estados' },
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'TRIAL', label: 'En prueba' },
  { value: 'PAST_DUE', label: 'Pago pendiente' },
  { value: 'SUSPENDED', label: 'Suspendidos' },
  { value: 'CANCELLED', label: 'Cancelados' },
];

const LIMIT = 25;

/** Badge del estado de suscripción, o "Sin suscripción" para los tenants que
 *  no tienen (existen: se pueden crear sin pasar por /auth/register). */
function StatusBadge({ tenant }: { tenant: TenantListItem }) {
  if (!tenant.subscription) return <Badge tone="neutral">Sin suscripción</Badge>;
  return (
    <Badge tone={STATUS_TONE[tenant.subscription.status]} dot>
      {STATUS_LABEL[tenant.subscription.status]}
    </Badge>
  );
}

function PlanBadge({ tenant }: { tenant: TenantListItem }) {
  if (!tenant.subscription) return <span className="text-muted-foreground">—</span>;
  return <Badge tone="primary">{tenant.subscription.plan.name}</Badge>;
}

export default function TenantsPageView() {
  const [data, setData] = useState<TenantsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | SubscriptionStatus>('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get<TenantsPage>('/super-admin/tenants', {
          query: { page, limit: LIMIT, search: search.trim() || undefined, status: status || undefined },
        }),
      );
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  // Debounce del buscador: sin esto, cada tecla dispara una request y el
  // endpoint tiene rate limit.
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 300);
    return () => clearTimeout(timer);
  }, [load]);

  // Cualquier cambio de filtro vuelve a la página 1 — si no, filtrar estando
  // en la página 3 puede dejar la tabla vacía sin explicación.
  function onSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }
  function onStatusChange(value: '' | SubscriptionStatus) {
    setStatus(value);
    setPage(1);
  }

  return (
    <div>
      <PageHeader
        title="Tenants"
        description="Los restaurantes que contrataron Chillberry: su plan, su estado y cuánto lo usan."
        actions={data ? <Badge tone="neutral">{data.total} en total</Badge> : undefined}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nombre o slug..."
            aria-label="Buscar tenants"
            className="input w-full pl-9"
          />
        </div>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as '' | SubscriptionStatus)}
          aria-label="Filtrar por estado de suscripción"
          className="input w-full sm:w-52"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={Building2}
          title="No hay tenants que coincidan"
          description={
            search || status
              ? 'Probá aflojando la búsqueda o el filtro de estado.'
              : 'Todavía no se registró ningún restaurante en Chillberry.'
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          {/* Desktop: tabla — es donde tiene sentido, se comparan plan/estado/uso
              entre muchos tenants de un vistazo. `overflow-x-auto` para que la
              tabla scrollee sola y nunca empuje el ancho de la página. */}
          <div className="panel hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Tenant</th>
                  <th scope="col" className="px-4 py-3 font-medium">País</th>
                  <th scope="col" className="px-4 py-3 font-medium">Plan</th>
                  <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Sucursales</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Usuarios</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Pedidos</th>
                  <th scope="col" className="px-4 py-3 font-medium">Alta</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t.countryCode} · {t.currency}
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge tenant={t} />
                      {t.subscription && (
                        <div className="mt-1 text-xs text-muted-foreground tabular">
                          {planPrice(t.subscription.plan.priceMonthly, t.subscription.plan.currency)}/mes
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tenant={t} />
                    </td>
                    <td className="px-4 py-3 text-right tabular">{t.usage.branches}</td>
                    <td className="px-4 py-3 text-right tabular">{t.usage.users}</td>
                    <td className="px-4 py-3 text-right tabular">{t.usage.orders}</td>
                    <td className="px-4 py-3 text-muted-foreground tabular">{formatDate(t.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/super-admin/tenants/${t.id}`} className="btn btn-sm">
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: la misma info como cards apiladas. Una tabla de 9 columnas a
              375px sería ilegible aunque scrollee. */}
          <ul className="space-y-2 md:hidden">
            {data.items.map((t) => (
              <li key={t.id} className="card p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-words font-heading font-medium text-foreground">{t.name}</div>
                    <div className="break-words text-xs text-muted-foreground">
                      {t.slug} · {t.countryCode} · {t.currency}
                    </div>
                  </div>
                  <StatusBadge tenant={t} />
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <PlanBadge tenant={t} />
                  {t.subscription && (
                    <span className="text-xs text-muted-foreground tabular">
                      {planPrice(t.subscription.plan.priceMonthly, t.subscription.plan.currency)}/mes
                    </span>
                  )}
                </div>

                <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-muted px-2 py-1.5">
                    <dt className="text-xs text-muted-foreground">Sucursales</dt>
                    <dd className="font-heading text-base tabular">{t.usage.branches}</dd>
                  </div>
                  <div className="rounded-md bg-muted px-2 py-1.5">
                    <dt className="text-xs text-muted-foreground">Usuarios</dt>
                    <dd className="font-heading text-base tabular">{t.usage.users}</dd>
                  </div>
                  <div className="rounded-md bg-muted px-2 py-1.5">
                    <dt className="text-xs text-muted-foreground">Pedidos</dt>
                    <dd className="font-heading text-base tabular">{t.usage.orders}</dd>
                  </div>
                </dl>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Alta: {formatDate(t.createdAt)}</span>
                  <Link href={`/super-admin/tenants/${t.id}`} className="btn btn-sm">
                    Ver detalle
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          {data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.page <= 1 || loading}
                className="btn btn-sm"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </button>
              <span className="text-sm text-muted-foreground tabular">
                Página {data.page} de {data.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={data.page >= data.totalPages || loading}
                className="btn btn-sm"
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
