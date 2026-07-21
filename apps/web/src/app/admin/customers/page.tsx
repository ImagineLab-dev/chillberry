'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, Search, Phone, Star, Pencil, Trash2, History, GitMerge, UserPlus, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { formatMoney } from '@chillberry/domain';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { CustomersTabs } from '@/components/customers-tabs';

const FALLBACK_COUNTRY_CODE = 'PY';

type Branch = { id: string; name: string };
type TenantSettings = { countryCode: string };
type Customer = {
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  hasRecord: boolean;
  orders: number;
  totalSpent: number;
  avgTicket: number;
  firstVisit: string | null;
  lastVisit: string | null;
};
type CustomersResponse = { total: number; totalRevenue: number; customers: Customer[] };
type LoyaltyAccount = { id: string; phone: string; name: string | null; points: number } | null;
type CustomerOrder = {
  id: string;
  total: string;
  type: string;
  completedAt: string | null;
  createdAt: string;
  items: { quantity: number; menuItem: { name: string } }[];
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function CustomersPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [countryCode, setCountryCode] = useState(FALLBACK_COUNTRY_CODE);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Saldo de puntos por teléfono. Solo se llena si el programa está activo.
  const [loyaltyActive, setLoyaltyActive] = useState(false);
  const [points, setPoints] = useState<Record<string, number>>({});

  // CRM: form de alta/edición (upsert por teléfono), historial y fusión.
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ phone: '', name: '', email: '', notes: '' });
  const [phoneLocked, setPhoneLocked] = useState(false); // true al editar (no cambiar el teléfono-identidad)
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<CustomerOrder[] | null>(null);

  useEffect(() => {
    api
      .get<Branch[]>('/branches')
      .then(setBranches)
      .catch((err) => setError((err as ApiError).message));
    api
      .get<TenantSettings>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
    api
      .get<{ active: boolean }>('/loyalty/program')
      .then((p) => setLoyaltyActive(p.active))
      .catch(() => {}); // sin permiso/error → no mostramos badges
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const query: Record<string, string> = {};
    if (branchId) query.branchId = branchId;
    if (search.trim()) query.search = search.trim();
    api
      .get<CustomersResponse>('/customers', { query })
      .then(setData)
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [branchId, search]);

  // Debounce simple sobre la búsqueda para no pegarle al server en cada tecla.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Saldos de puntos de los clientes VISIBLES. Para evitar el N+1 (hasta 200
  // clientes), no se hace un fetch por cliente dentro del render: se disparan
  // todos en paralelo con Promise.allSettled cuando cambia la lista, y se
  // guarda un mapa phone → points. Si el programa está inactivo, no se consulta.
  useEffect(() => {
    if (!loyaltyActive || !data || data.customers.length === 0) {
      setPoints({});
      return;
    }
    let cancelled = false;
    const phones = data.customers.map((c) => c.phone);
    Promise.allSettled(
      phones.map((phone) => api.get<LoyaltyAccount>(`/loyalty/accounts/${encodeURIComponent(phone)}`)),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      results.forEach((r, i) => {
        const phone = phones[i];
        if (phone && r.status === 'fulfilled' && r.value && r.value.points > 0) {
          map[phone] = r.value.points;
        }
      });
      setPoints(map);
    });
    return () => {
      cancelled = true;
    };
  }, [data, loyaltyActive]);

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (msg) setNotice(msg);
      load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setForm({ phone: '', name: '', email: '', notes: '' });
    setPhoneLocked(false);
    setFormOpen(true);
    setNotice(null);
  }

  function openEdit(c: Customer) {
    setForm({ phone: c.phone, name: c.name ?? '', email: c.email ?? '', notes: c.notes ?? '' });
    setPhoneLocked(true);
    setFormOpen(true);
    setNotice(null);
  }

  function onSaveForm(e: React.FormEvent) {
    e.preventDefault();
    if (form.phone.trim().length < 6 || !form.name.trim()) return;
    void run(async () => {
      await api.put('/customers', {
        phone: form.phone.trim(),
        name: form.name.trim(),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      setFormOpen(false);
    }, 'Cliente guardado.');
  }

  function onDelete(c: Customer) {
    if (!confirm(`¿Eliminar la ficha de ${c.name ?? c.phone}? Sus pedidos NO se borran.`)) return;
    void run(() => api.delete('/customers', { query: { phone: c.phone } }));
  }

  function onMerge(c: Customer) {
    const alias = window.prompt(
      `Fusionar OTRO cliente dentro de "${c.name ?? c.phone}".\nEscribí el teléfono del duplicado (se le pasan sus pedidos y puntos a ${c.phone}):`,
    )?.trim();
    if (!alias || alias === c.phone) return;
    void run(() => api.post('/customers/merge', { canonicalPhone: c.phone, aliasPhone: alias }), 'Clientes fusionados.');
  }

  async function onAdjustPoints(c: Customer) {
    const raw = window.prompt(`Ajustar puntos de ${c.name ?? c.phone} (ej: +50 para sumar, -20 para restar):`);
    if (raw == null) return;
    const delta = Math.trunc(Number(raw.replace('+', '')));
    if (!Number.isFinite(delta) || delta === 0) return;
    const note = window.prompt('Motivo del ajuste:')?.trim();
    if (!note || note.length < 3) return;
    setError(null);
    try {
      const acc = await api.post<{ points: number }>('/loyalty/adjust', { phone: c.phone, delta, note });
      setPoints((p) => ({ ...p, [c.phone]: acc.points }));
      setNotice(`Puntos ajustados: ${c.name ?? c.phone} ahora tiene ${acc.points}.`);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function toggleHistory(phone: string) {
    if (historyFor === phone) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor(phone);
    setHistory(null);
    try {
      setHistory(await api.get<CustomerOrder[]>('/customers/orders', { query: { phone } }));
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Tus clientes frecuentes, armados a partir de los pedidos con teléfono."
      />
      <CustomersTabs />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="label" htmlFor="cust-branch">
            Sucursal
          </label>
          <select
            id="cust-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="input w-full sm:w-52"
          >
            <option value="">Todas</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
          <label className="label" htmlFor="cust-search">
            Buscar
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id="cust-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre o teléfono"
              className="input w-full pl-9"
            />
          </div>
        </div>
        <button onClick={openCreate} className="btn btn-primary">
          <UserPlus className="h-4 w-4" />
          Nuevo cliente
        </button>
      </div>

      {formOpen && (
        <form onSubmit={onSaveForm} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Teléfono</span>
            <input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+595..."
              disabled={phoneLocked}
              className="input w-40"
              required
            />
          </label>
          <label className="flex-1 space-y-1 text-sm">
            <span className="text-muted-foreground">Nombre</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="input w-full"
              required
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Email (opcional)</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="input w-52"
            />
          </label>
          <label className="w-full space-y-1 text-sm">
            <span className="text-muted-foreground">Notas (opcional)</span>
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Alergias, preferencias…"
              className="input w-full"
            />
          </label>
          <div className="flex gap-2">
            <button disabled={busy} className="btn btn-primary">
              {phoneLocked ? 'Guardar cambios' : 'Crear cliente'}
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="btn btn-ghost">
              <X className="h-4 w-4" />
              Cancelar
            </button>
          </div>
        </form>
      )}

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

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {!loading && data && data.customers.length === 0 && (
        <EmptyState
          icon={Users}
          title="Todavía no hay clientes cargados"
          description="Cuando se cobren pedidos con el teléfono del cliente (por ejemplo desde el menú QR), vas a ver acá quiénes son tus habitués y cuánto gastan."
        />
      )}

      {!loading && data && data.customers.length > 0 && (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{data.total}</span> cliente
            {data.total === 1 ? '' : 's'} · {formatMoney(data.totalRevenue, countryCode)} facturado en total
          </p>

          <ul className="space-y-2">
            {data.customers.map((c) => (
              <li key={c.phone} className="card card-dense p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-heading font-medium text-foreground">{c.name ?? 'Sin nombre'}</p>
                      {points[c.phone] != null && (
                        <Badge tone="primary">
                          <Star className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {points[c.phone]} puntos
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {c.phone}
                      {c.email && <span className="ml-2">· {c.email}</span>}
                    </p>
                    {c.notes && <p className="mt-0.5 text-xs italic text-muted-foreground">{c.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="tabular font-heading text-lg font-semibold text-foreground">
                      {formatMoney(c.totalSpent, countryCode)}
                    </p>
                    <p className="text-xs text-muted-foreground">total gastado</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
                  <span>
                    <span className="tabular font-medium text-foreground">{c.orders}</span> visita
                    {c.orders === 1 ? '' : 's'}
                  </span>
                  <span>
                    Ticket promedio{' '}
                    <span className="tabular font-medium text-foreground">
                      {formatMoney(c.avgTicket, countryCode)}
                    </span>
                  </span>
                  <span>Última visita {formatDate(c.lastVisit)}</span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    <button onClick={() => openEdit(c)} disabled={busy} className="btn btn-ghost btn-sm" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </button>
                    {loyaltyActive && (
                      <button onClick={() => onAdjustPoints(c)} disabled={busy} className="btn btn-ghost btn-sm" title="Ajustar puntos">
                        <Star className="h-4 w-4" />
                      </button>
                    )}
                    {c.orders > 0 && (
                      <button onClick={() => void toggleHistory(c.phone)} className="btn btn-ghost btn-sm" title="Historial de pedidos">
                        <History className="h-4 w-4" />
                      </button>
                    )}
                    <button onClick={() => onMerge(c)} disabled={busy} className="btn btn-ghost btn-sm" title="Fusionar un duplicado en este cliente">
                      <GitMerge className="h-4 w-4" />
                    </button>
                    {c.hasRecord && (
                      <button onClick={() => onDelete(c)} disabled={busy} className="btn btn-ghost btn-sm text-error" title="Eliminar ficha">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {historyFor === c.phone && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-2 text-xs font-semibold text-muted-foreground">Últimos pedidos</p>
                    {history == null ? (
                      <Skeleton className="h-10" />
                    ) : history.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sin pedidos.</p>
                    ) : (
                      <ul className="space-y-1 text-xs">
                        {history.map((o) => (
                          <li key={o.id} className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-muted-foreground">
                              {formatDate(o.completedAt ?? o.createdAt)} ·{' '}
                              {o.items.map((it) => `${it.quantity}× ${it.menuItem.name}`).join(', ')}
                            </span>
                            <span className="tabular shrink-0 font-medium text-foreground">
                              {formatMoney(o.total, countryCode)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
