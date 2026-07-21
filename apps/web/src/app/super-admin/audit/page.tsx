'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { ACTION_LABEL, ACTION_TONE, formatDateTime, type AuditPage } from '../_shared';

const LIMIT = 25;

type Detail = {
  reason?: string | null;
  fromPlan?: { name?: string };
  toPlan?: { name?: string };
  previousStatus?: string;
  newStatus?: string;
  usageAtChange?: { branches?: number; users?: number };
};

/**
 * Resumen legible del `detail` (JSON libre). Se muestra el JSON crudo abajo
 * igual: si mañana se audita una acción nueva que este resumen no contempla,
 * la info sigue estando a la vista en vez de desaparecer.
 */
function DetailSummary({ action, detail }: { action: string; detail: Detail | null }) {
  if (!detail) return null;

  if (action === 'CHANGE_PLAN' && detail.fromPlan && detail.toPlan) {
    return (
      <span>
        {detail.fromPlan.name} → <span className="font-medium text-foreground">{detail.toPlan.name}</span>
        {detail.usageAtChange && (
          <span className="text-muted-foreground tabular">
            {' '}(uso: {detail.usageAtChange.branches} suc. / {detail.usageAtChange.users} usr.)
          </span>
        )}
      </span>
    );
  }
  if (detail.previousStatus && detail.newStatus) {
    return (
      <span>
        {detail.previousStatus} → <span className="font-medium text-foreground">{detail.newStatus}</span>
      </span>
    );
  }
  return null;
}

export default function AuditPageView() {
  const [data, setData] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<AuditPage>('/super-admin/audit', { query: { page, limit: LIMIT } }));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Auditoría"
        description="Cada acción de escritura del staff de Smartia sobre un tenant: quién, qué, sobre quién y cuándo."
        actions={data ? <Badge tone="neutral">{data.total} registros</Badge> : undefined}
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && !data && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {data && data.items.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title="Todavía no hay nada auditado"
          description="Acá va a quedar registrada cada vez que alguien del equipo cambie un plan o suspenda a un cliente."
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="space-y-2">
            {data.items.map((log) => {
              const detail = log.detail as Detail | null;
              return (
                <li key={log.id} className="card p-4 text-sm">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ACTION_TONE[log.action] ?? 'neutral'}>
                        {ACTION_LABEL[log.action] ?? log.action}
                      </Badge>
                      {/* El log sobrevive al borrado del tenant (sin FK), así que
                          el nombre puede faltar — se muestra el id en ese caso. */}
                      {log.targetTenant.slug ? (
                        <Link
                          href={`/super-admin/tenants/${log.targetTenant.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {log.targetTenant.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">tenant eliminado ({log.targetTenant.id.slice(0, 8)})</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground tabular">{formatDateTime(log.createdAt)}</span>
                  </div>

                  <div className="space-y-1 text-muted-foreground">
                    <div>
                      <DetailSummary action={log.action} detail={detail} />
                    </div>
                    {detail?.reason && (
                      <div className="break-words">
                        Motivo: <span className="text-foreground">{detail.reason}</span>
                      </div>
                    )}
                    <div className="text-xs">
                      Por: {log.superAdmin.email ?? `usuario eliminado (${log.superAdmin.id.slice(0, 8)})`}
                    </div>
                  </div>

                  {detail && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Ver detalle completo
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2 text-xs">
                        {JSON.stringify(detail, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
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
