'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Star, Users } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { CustomersTabs } from '@/components/customers-tabs';

type Branch = { id: string; name: string };
type Results = {
  average: number | null;
  count: number;
  pending: number;
  distribution: { star: number; count: number }[];
  byWaiter: { waiterId: string | null; waiterName: string; average: number; count: number }[];
  comments: { rating: number | null; comment: string; at: string | null }[];
};

/** Fila de estrellas para una calificación (llenas hasta `value`). */
function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          style={{ width: size, height: size }}
          className={s <= Math.round(value) ? 'fill-warn text-warn' : 'text-muted-foreground/40'}
        />
      ))}
    </span>
  );
}

export default function FeedbackPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [results, setResults] = useState<Results | null>(null);
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
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const query: Record<string, string> = {};
    if (branchId) query.branchId = branchId;
    api
      .get<Results>('/feedback', { query })
      .then(setResults)
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const maxDist = results ? Math.max(1, ...results.distribution.map((d) => d.count)) : 1;
  const responseRate =
    results && results.count + results.pending > 0
      ? Math.round((results.count / (results.count + results.pending)) * 100)
      : null;

  return (
    <div>
      <PageHeader
        title="Opiniones de clientes"
        description="Calificación de la atención — la encuesta llega por WhatsApp unas horas después de cada visita."
      />
      <CustomersTabs />

      <div className="mb-6">
        <label className="label mb-1.5 block" htmlFor="fb-branch">
          Sucursal
        </label>
        <select
          id="fb-branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="input w-full sm:w-52"
        >
          {branches.length > 1 && <option value="">Todas las sucursales</option>}
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {loading && <Skeleton className="h-40" />}

      {!loading && results && results.count === 0 && (
        <EmptyState
          icon={Star}
          title="Todavía no hay opiniones"
          description="Cuando tus clientes respondan la encuesta que les llega por WhatsApp, vas a ver acá la calificación promedio, los comentarios y el desempeño por mozo."
        />
      )}

      {!loading && results && results.count > 0 && (
        <div className="space-y-6">
          {/* Resumen: promedio grande + distribución. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="card flex flex-col items-center justify-center p-6">
              <p className="tabular font-heading text-5xl font-semibold text-foreground">
                {results.average?.toFixed(1) ?? '—'}
              </p>
              <div className="mt-2">
                <Stars value={results.average ?? 0} size={20} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {results.count} {results.count === 1 ? 'opinión' : 'opiniones'}
                {responseRate !== null && ` · ${responseRate}% respondió`}
              </p>
            </div>

            <div className="card p-5 md:col-span-2">
              <h2 className="mb-3 font-heading text-base font-semibold">Distribución</h2>
              <div className="space-y-1.5">
                {[...results.distribution].reverse().map((d) => (
                  <div key={d.star} className="flex items-center gap-2 text-sm">
                    <span className="flex w-12 shrink-0 items-center gap-1 text-muted-foreground">
                      {d.star} <Star className="h-3 w-3 fill-warn text-warn" />
                    </span>
                    <div className="h-4 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-warn" style={{ width: `${(d.count / maxDist) * 100}%` }} />
                    </div>
                    <span className="tabular w-8 shrink-0 text-right text-muted-foreground">{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Calificación por mozo. */}
          {results.byWaiter.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Calificación por mesero
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Mesero</th>
                      <th className="pb-2 font-medium">Promedio</th>
                      <th className="pb-2 text-right font-medium">Opiniones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.byWaiter.map((w) => (
                      <tr
                        key={w.waiterId ?? 'unassigned'}
                        className={`border-b border-border/60 ${w.waiterId ? '' : 'text-muted-foreground'}`}
                      >
                        <td className="py-2">{w.waiterName}</td>
                        <td className="py-2">
                          <span className="flex items-center gap-2">
                            <span className="tabular font-medium">{w.average.toFixed(1)}</span>
                            <Stars value={w.average} />
                          </span>
                        </td>
                        <td className="tabular py-2 text-right text-muted-foreground">{w.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Comentarios recientes. */}
          {results.comments.length > 0 && (
            <section className="card p-5">
              <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
                <MessageSquare className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                Comentarios
              </h2>
              <ul className="space-y-3">
                {results.comments.map((c, i) => (
                  <li key={i} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                    <div className="mb-1">{c.rating != null && <Stars value={c.rating} />}</div>
                    <p className="text-sm text-foreground">{c.comment}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
