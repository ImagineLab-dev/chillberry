'use client';

import { useEffect, useState } from 'react';
import { Bug, Check, Lightbulb, MessageSquarePlus, RotateCcw } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui';

type SupportRequest = {
  id: string;
  tenantId: string;
  type: 'BUG' | 'SUGGESTION';
  message: string;
  context: string | null;
  handled: boolean;
  createdAt: string;
  tenant: { name: string; slug: string } | null;
};

export default function SuperAdminSugerenciasPage() {
  const [items, setItems] = useState<SupportRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setItems(await api.get<SupportRequest[]>('/super-admin/support'));
      setError(null);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(item: SupportRequest) {
    setBusyId(item.id);
    try {
      await api.patch(`/super-admin/support/${item.id}/handled`, { handled: !item.handled });
      setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, handled: !i.handled } : i)) ?? null);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusyId(null);
    }
  }

  const pendientes = items?.filter((i) => !i.handled).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-foreground">
          <MessageSquarePlus className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          Sugerencias y reportes
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que reportan los restaurantes desde su panel. Sin atender arriba.
          {items && (
            <>
              {' '}
              <span className="font-medium text-foreground">{pendientes} pendiente{pendientes === 1 ? '' : 's'}</span> de{' '}
              {items.length}.
            </>
          )}
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {!items && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {items && items.length === 0 && (
        <EmptyState
          icon={MessageSquarePlus}
          title="Todavía no hay reportes ni sugerencias"
          description="Cuando un restaurante mande algo desde su panel, aparece acá."
        />
      )}

      {items && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((item) => {
            const esBug = item.type === 'BUG';
            return (
              <li key={item.id} className={`card p-4 ${item.handled ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={esBug ? 'error' : 'primary'}>
                      {esBug ? (
                        <span className="flex items-center gap-1">
                          <Bug className="h-3.5 w-3.5" /> Problema
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Lightbulb className="h-3.5 w-3.5" /> Sugerencia
                        </span>
                      )}
                    </Badge>
                    <span className="font-heading text-sm font-semibold text-foreground">
                      {item.tenant?.name ?? 'Restaurante'}
                    </span>
                    {item.handled && <Badge tone="ok">Atendido</Badge>}
                  </div>
                  <span className="tabular text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString('es-PY', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.message}</p>
                {item.context && (
                  <p className="mt-1.5 break-words text-xs text-muted-foreground">📍 {item.context}</p>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    disabled={busyId === item.id}
                    className="btn btn-sm min-h-[40px]"
                  >
                    {item.handled ? (
                      <>
                        <RotateCcw className="h-4 w-4" /> Reabrir
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4" /> Marcar atendido
                      </>
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
