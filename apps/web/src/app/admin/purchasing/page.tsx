'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, PackageCheck, Plus, Trash2, Truck, X } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui';

const FALLBACK_COUNTRY_CODE = 'PY';

type Branch = { id: string; name: string };
type Supplier = { id: string; name: string; contactName: string | null; phone: string | null; active: boolean };
type Ingredient = { id: string; name: string; unit: string; stockQty: string; active: boolean };
type POLine = { id: string; quantity: string; unitCost: string; ingredient: { name: string; unit: string } };
type PurchaseOrder = {
  id: string;
  status: 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';
  total: string;
  notes: string | null;
  receivedAt: string | null;
  createdAt: string;
  supplier: { id: string; name: string };
  items: POLine[];
};

const STATUS_META: Record<PurchaseOrder['status'], { label: string; tone: Tone }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  ORDERED: { label: 'Pedida', tone: 'info' },
  RECEIVED: { label: 'Recibida', tone: 'ok' },
  CANCELLED: { label: 'Cancelada', tone: 'error' },
};

// Una línea del formulario de nueva OC (antes de mandarse).
type DraftLine = { ingredientId: string; quantity: string; unitCost: string };

export default function PurchasingPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [countryCode, setCountryCode] = useState(FALLBACK_COUNTRY_CODE);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Alta de proveedor.
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');

  // Nueva orden de compra.
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poLines, setPoLines] = useState<DraftLine[]>([{ ingredientId: '', quantity: '', unitCost: '' }]);
  const [poBusy, setPoBusy] = useState(false);

  useEffect(() => {
    api
      .get<Branch[]>('/branches')
      .then((b) => {
        setBranches(b);
        if (b[0]) setBranchId(b[0].id);
      })
      .catch((err) => setError((err as ApiError).message));
    api
      .get<{ countryCode: string }>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
    api.get<Supplier[]>('/purchasing/suppliers').then(setSuppliers).catch(() => {});
  }, []);

  const loadForBranch = useCallback(() => {
    if (!branchId) return;
    setLoading(true);
    Promise.all([
      api.get<Ingredient[]>('/inventory/ingredients', { query: { branchId } }),
      api.get<PurchaseOrder[]>('/purchasing/orders', { query: { branchId } }),
    ])
      .then(([ings, pos]) => {
        setIngredients(ings.filter((i) => i.active));
        setOrders(pos);
      })
      .catch((err) => setError((err as ApiError).message))
      .finally(() => setLoading(false));
  }, [branchId]);

  useEffect(() => {
    loadForBranch();
  }, [loadForBranch]);

  async function onCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/purchasing/suppliers', {
        name: supName,
        contactName: supContact || undefined,
        phone: supPhone || undefined,
      });
      setSupName('');
      setSupContact('');
      setSupPhone('');
      setSuppliers(await api.get<Supplier[]>('/purchasing/suppliers'));
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  const draftTotal = poLines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

  async function onCreatePO(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const items = poLines
      .filter((l) => l.ingredientId && Number(l.quantity) > 0)
      .map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0 }));
    if (!poSupplierId || items.length === 0) {
      setError('Elegí un proveedor y al menos un insumo con cantidad.');
      return;
    }
    setPoBusy(true);
    try {
      await api.post('/purchasing/orders', { branchId, supplierId: poSupplierId, markOrdered: true, items });
      setPoSupplierId('');
      setPoLines([{ ingredientId: '', quantity: '', unitCost: '' }]);
      setNotice('Orden de compra creada.');
      loadForBranch();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setPoBusy(false);
    }
  }

  async function onReceive(po: PurchaseOrder) {
    if (!confirm(`¿Recibir la orden de ${po.supplier.name}? Esto suma el stock de cada insumo.`)) return;
    setError(null);
    setNotice(null);
    try {
      await api.post(`/purchasing/orders/${po.id}/receive`);
      setNotice('Orden recibida — el stock se actualizó.');
      loadForBranch();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function onCancelPO(po: PurchaseOrder) {
    if (!confirm(`¿Cancelar la orden de ${po.supplier.name}?`)) return;
    setError(null);
    try {
      await api.patch(`/purchasing/orders/${po.id}/cancel`);
      loadForBranch();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Proveedores y órdenes de compra. Al recibir una orden, el stock de cada insumo sube solo."
      />

      <div className="mb-6">
        <label className="label mb-1.5 block" htmlFor="pur-branch">
          Sucursal
        </label>
        <select
          id="pur-branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="input w-full sm:w-52"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}
      {notice && <Alert tone="ok" className="mb-4">{notice}</Alert>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---- Proveedores ---- */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
            <Truck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Proveedores
          </h2>
          <form onSubmit={onCreateSupplier} className="panel mb-4 flex flex-col gap-2 p-4">
            <input
              value={supName}
              onChange={(e) => setSupName(e.target.value)}
              placeholder="Nombre del proveedor"
              required
              className="input w-full"
            />
            <div className="flex flex-wrap gap-2">
              <input
                value={supContact}
                onChange={(e) => setSupContact(e.target.value)}
                placeholder="Contacto (opcional)"
                className="input min-w-0 flex-1"
              />
              <input
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                placeholder="Teléfono (opcional)"
                className="input min-w-0 flex-1"
              />
            </div>
            <button className="btn btn-primary self-start">
              <Plus className="h-4 w-4" />
              Agregar proveedor
            </button>
          </form>

          {suppliers.length === 0 ? (
            <EmptyState icon={Truck} title="Sin proveedores" description="Cargá tus proveedores para poder armar órdenes de compra." />
          ) : (
            <ul className="space-y-2">
              {suppliers.map((s) => (
                <li key={s.id} className="card flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{s.name}</span>
                    {(s.contactName || s.phone) && (
                      <span className="block text-xs text-muted-foreground">
                        {[s.contactName, s.phone].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {!s.active && <Badge tone="neutral">Inactivo</Badge>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Nueva orden de compra ---- */}
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold">
            <PackageCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Nueva orden de compra
          </h2>
          <form onSubmit={onCreatePO} className="panel flex flex-col gap-3 p-4">
            <select
              value={poSupplierId}
              onChange={(e) => setPoSupplierId(e.target.value)}
              className="input w-full"
              aria-label="Proveedor"
            >
              <option value="">Elegí un proveedor...</option>
              {suppliers.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            {poLines.map((line, idx) => (
              <div key={idx} className="flex flex-wrap items-center gap-2">
                <select
                  value={line.ingredientId}
                  onChange={(e) =>
                    setPoLines((p) => p.map((l, i) => (i === idx ? { ...l, ingredientId: e.target.value } : l)))
                  }
                  className="input min-w-0 flex-1"
                  aria-label="Insumo"
                >
                  <option value="">Insumo...</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.unit})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={line.quantity}
                  onChange={(e) => setPoLines((p) => p.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)))}
                  placeholder="Cant."
                  aria-label="Cantidad"
                  className="input tabular w-20"
                />
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={line.unitCost}
                  onChange={(e) => setPoLines((p) => p.map((l, i) => (i === idx ? { ...l, unitCost: e.target.value } : l)))}
                  placeholder="Costo un."
                  aria-label="Costo unitario"
                  className="input tabular w-24"
                />
                {poLines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPoLines((p) => p.filter((_, i) => i !== idx))}
                    className="btn btn-ghost btn-sm px-2"
                    aria-label="Quitar renglón"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPoLines((p) => [...p, { ingredientId: '', quantity: '', unitCost: '' }])}
              className="btn btn-sm self-start"
            >
              <Plus className="h-4 w-4" />
              Otro insumo
            </button>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">Total estimado</span>
              <span className="tabular font-heading text-lg font-semibold">{formatMoney(draftTotal, countryCode)}</span>
            </div>
            <button disabled={poBusy} className="btn btn-primary self-start">
              {poBusy ? 'Creando...' : 'Crear orden de compra'}
            </button>
          </form>
        </section>
      </div>

      {/* ---- Órdenes de compra ---- */}
      <h2 className="mb-3 mt-8 font-heading text-lg font-semibold">Órdenes de compra</h2>
      {loading && <Skeleton className="h-32" />}
      {!loading && orders.length === 0 && (
        <EmptyState
          icon={PackageCheck}
          title="Sin órdenes de compra"
          description="Armá una orden arriba: al recibirla, el stock de cada insumo se actualiza automáticamente."
        />
      )}
      <div className="space-y-3">
        {orders.map((po) => {
          const meta = STATUS_META[po.status];
          const canAct = po.status === 'DRAFT' || po.status === 'ORDERED';
          return (
            <div key={po.id} className="card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="font-heading font-semibold">{po.supplier.name}</span>
                  <Badge tone={meta.tone} dot>
                    {meta.label}
                  </Badge>
                </span>
                <span className="tabular font-medium">{formatMoney(po.total, countryCode)}</span>
              </div>
              <ul className="mb-2 space-y-0.5 text-sm text-muted-foreground">
                {po.items.map((it) => (
                  <li key={it.id}>
                    <span className="tabular">{Number(it.quantity)}</span> {it.ingredient.unit} · {it.ingredient.name}{' '}
                    <span className="text-xs">@ {formatMoney(it.unitCost, countryCode)}</span>
                  </li>
                ))}
              </ul>
              {canAct && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => onReceive(po)} className="btn btn-primary btn-sm">
                    <Check className="h-4 w-4" />
                    Recibir (sumar stock)
                  </button>
                  <button type="button" onClick={() => onCancelPO(po)} className="btn btn-ghost btn-sm text-error-foreground">
                    <X className="h-4 w-4" />
                    Cancelar
                  </button>
                </div>
              )}
              {po.status === 'RECEIVED' && po.receivedAt && (
                <p className="text-xs text-muted-foreground">
                  Recibida el {new Date(po.receivedAt).toLocaleDateString('es-PY')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
