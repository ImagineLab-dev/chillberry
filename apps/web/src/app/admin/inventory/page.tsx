'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, ClipboardCheck, DollarSign, History, Minus, Plus, Power, Trash2, X } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';

type Branch = { id: string; name: string };
type Ingredient = {
  id: string;
  name: string;
  unit: string;
  stockQty: string;
  lowStockAt: string | null;
  costPerUnit: string | null;
  active: boolean;
};
type StockMove = {
  id: string;
  type: 'PURCHASE' | 'ADJUST' | 'WASTE' | 'COUNT' | 'SALE';
  quantityDelta: string;
  reason: string | null;
  createdAt: string;
};
const MOVE_LABEL: Record<StockMove['type'], string> = {
  PURCHASE: 'Compra',
  ADJUST: 'Ajuste',
  WASTE: 'Merma',
  COUNT: 'Conteo',
  SALE: 'Venta',
};
type MenuItemLite = { id: string; name: string; isCombo: boolean };
type RecipeRow = {
  id: string;
  ingredientId: string;
  quantity: string;
  ingredient: { id: string; name: string; unit: string; stockQty: string; active: boolean };
};

function isLow(i: Ingredient): boolean {
  return i.lowStockAt != null && Number(i.stockQty) <= Number(i.lowStockAt);
}

// Unidades de medida comunes en cocina. Desplegable para que el stock y las
// recetas usen SIEMPRE la misma unidad (el backend no convierte: suma/resta en
// la misma unidad). Cubre peso, volumen y conteo.
const UNITS = ['unidad', 'g', 'kg', 'ml', 'l', 'docena', 'porción', 'rebanada', 'paquete'] as const;

export default function InventoryPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tab, setTab] = useState<'insumos' | 'recetas'>('insumos');
  const [countryCode, setCountryCode] = useState('PY');
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
      .get<{ countryCode: string }>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
  }, []);

  return (
    <div>
      <PageHeader
        title="Inventario"
        description="Insumos por sucursal y la receta de cada producto. El stock baja solo cuando se vende un pedido."
      />

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input w-full sm:w-64">
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button onClick={() => setTab('insumos')} className={`btn btn-sm ${tab === 'insumos' ? 'btn-primary' : ''}`}>
            Insumos
          </button>
          <button onClick={() => setTab('recetas')} className={`btn btn-sm ${tab === 'recetas' ? 'btn-primary' : ''}`}>
            Recetas
          </button>
        </div>
      </div>

      {branchId && tab === 'insumos' && <IngredientsTab branchId={branchId} countryCode={countryCode} />}
      {branchId && tab === 'recetas' && <RecipesTab branchId={branchId} />}
    </div>
  );
}

// ============================================================== INSUMOS

function IngredientsTab({ branchId, countryCode }: { branchId: string; countryCode: string }) {
  const [items, setItems] = useState<Ingredient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [unit, setUnit] = useState('unidad');
  const [stock, setStock] = useState('');
  const [lowAt, setLowAt] = useState('');
  const [cost, setCost] = useState('');

  const [adjust, setAdjust] = useState<Record<string, string>>({});

  // Historial de movimientos: qué insumo está expandido y sus filas.
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, StockMove[]>>({});

  const load = useCallback(async () => {
    try {
      setItems(await api.get<Ingredient[]>('/inventory/ingredients', { query: { branchId } }));
    } catch (err) {
      setError((err as ApiError).message);
      setItems([]);
    }
  }, [branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) return;
    void run(async () => {
      await api.post('/inventory/ingredients', {
        branchId,
        name: name.trim(),
        unit: unit.trim(),
        stockQty: stock === '' ? 0 : Number(stock),
        ...(lowAt !== '' ? { lowStockAt: Number(lowAt) } : {}),
        ...(cost !== '' ? { costPerUnit: Number(cost) } : {}),
      });
      setName('');
      setStock('');
      setLowAt('');
      setCost('');
    });
  }

  function onAdjust(id: string, sign: 1 | -1) {
    const raw = adjust[id];
    const val = Number(raw);
    if (!raw || !Number.isFinite(val) || val <= 0) return;
    void run(async () => {
      await api.post(`/inventory/ingredients/${id}/adjust`, { delta: sign * val });
      setAdjust((a) => ({ ...a, [id]: '' }));
    });
  }

  // Merma: descuenta la cantidad del input con motivo (type WASTE).
  function onWaste(id: string) {
    const val = Number(adjust[id]);
    if (!Number.isFinite(val) || val <= 0) return;
    const reason = window.prompt('¿Motivo de la merma?')?.trim();
    if (!reason) return;
    void run(async () => {
      await api.post(`/inventory/ingredients/${id}/adjust`, { delta: -val, type: 'WASTE', reason });
      setAdjust((a) => ({ ...a, [id]: '' }));
    });
  }

  // Conteo físico: setea el stock al valor contado (registra el delta).
  function onCount(i: Ingredient) {
    const raw = window.prompt(`Conteo físico de "${i.name}" — cantidad real contada:`, String(Number(i.stockQty)));
    if (raw == null) return;
    const counted = Number(raw);
    if (!Number.isFinite(counted) || counted < 0) return;
    const reason = window.prompt('Motivo/nota (opcional):')?.trim() || undefined;
    void run(async () => {
      await api.post(`/inventory/ingredients/${i.id}/count`, { countedQty: counted, ...(reason ? { reason } : {}) });
    });
  }

  // Setear/editar el costo por unidad de un insumo (para valuación).
  function onSetCost(i: Ingredient) {
    const raw = window.prompt(
      `Costo por ${i.unit} de "${i.name}" (vacío = sin costo):`,
      i.costPerUnit ? String(Number(i.costPerUnit)) : '',
    );
    if (raw == null) return;
    const val = raw.trim() === '' ? null : Number(raw);
    if (val !== null && (!Number.isFinite(val) || val < 0)) return;
    void run(() => api.patch(`/inventory/ingredients/${i.id}`, { costPerUnit: val }));
  }

  async function toggleHistory(id: string) {
    if (historyFor === id) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor(id);
    try {
      const data = await api.get<StockMove[]>(`/inventory/ingredients/${id}/movements`);
      setMoves((m) => ({ ...m, [id]: data }));
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <form onSubmit={onCreate} className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <label className="flex-1 space-y-1 text-sm">
          <span className="text-muted-foreground">Insumo</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pan, queso, gaseosa…" className="input w-full" required />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Unidad</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="input w-28" required>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Stock inicial</span>
          <input type="number" min={0} step="0.001" value={stock} onChange={(e) => setStock(e.target.value)} className="input tabular w-28" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Alerta si ≤</span>
          <input type="number" min={0} step="0.001" value={lowAt} onChange={(e) => setLowAt(e.target.value)} placeholder="opcional" className="input tabular w-28" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Costo x unidad</span>
          <input type="number" min={0} step="0.0001" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="opcional" className="input tabular w-28" />
        </label>
        <button disabled={busy} className="btn btn-primary">
          <Plus className="h-4 w-4" />
          Agregar
        </button>
      </form>

      {items === null && (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}

      {items?.length === 0 && (
        <EmptyState icon={Boxes} title="Todavía no cargaste insumos" description="Agregá tus insumos acá arriba. Después, en la pestaña Recetas, definís cuánto consume cada producto." />
      )}

      {items && items.some((i) => i.costPerUnit) && (
        <p className="mb-3 text-sm text-muted-foreground">
          Valor total del inventario:{' '}
          <span className="tabular font-semibold text-foreground">
            {formatMoney(
              items.reduce((s, i) => s + (i.costPerUnit ? Number(i.stockQty) * Number(i.costPerUnit) : 0), 0),
              countryCode,
            )}
          </span>
          <span className="ml-1 text-xs">(solo insumos con costo cargado)</span>
        </p>
      )}

      <ul className="space-y-2">
        {items?.map((i) => (
          <li key={i.id} className={`card px-4 py-3 text-sm ${i.active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="font-heading font-medium text-foreground">{i.name}</span>
                <span className="ml-2 text-muted-foreground">
                  <span className="tabular font-semibold text-foreground">{Number(i.stockQty)}</span> {i.unit}
                </span>
                {i.costPerUnit && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    · {formatMoney(Number(i.costPerUnit), countryCode)}/{i.unit} · vale{' '}
                    <span className="tabular text-foreground">
                      {formatMoney(Number(i.stockQty) * Number(i.costPerUnit), countryCode)}
                    </span>
                  </span>
                )}
                {isLow(i) && <Badge tone="warn" className="ml-2">Stock bajo</Badge>}
                {!i.active && <Badge tone="error" className="ml-2">Inactivo</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    value={adjust[i.id] ?? ''}
                    onChange={(e) => setAdjust((a) => ({ ...a, [i.id]: e.target.value }))}
                    placeholder="cant."
                    className="input tabular w-20"
                    aria-label={`Cantidad a ajustar de ${i.name}`}
                  />
                  <button onClick={() => onAdjust(i.id, 1)} disabled={busy} className="btn btn-sm" title="Reponer (sumar al stock)">
                    <Plus className="h-4 w-4" />
                  </button>
                  <button onClick={() => onAdjust(i.id, -1)} disabled={busy} className="btn btn-sm" title="Descontar del stock (ajuste)">
                    <Minus className="h-4 w-4" />
                  </button>
                  <button onClick={() => onWaste(i.id)} disabled={busy} className="btn btn-sm" title="Merma (baja con motivo)">
                    Merma
                  </button>
                </div>
                <button onClick={() => onCount(i)} disabled={busy} className="btn btn-sm" title="Conteo físico (setea el stock al valor contado)">
                  <ClipboardCheck className="h-4 w-4" />
                  Conteo
                </button>
                <button onClick={() => onSetCost(i)} disabled={busy} className="btn btn-sm" title="Costo por unidad (para valuación)">
                  <DollarSign className="h-4 w-4" />
                </button>
                <button
                  onClick={() => void toggleHistory(i.id)}
                  className="btn btn-sm"
                  title="Historial de movimientos"
                  aria-expanded={historyFor === i.id}
                >
                  <History className="h-4 w-4" />
                </button>
                <button
                  onClick={() => void run(() => api.patch(`/inventory/ingredients/${i.id}`, { active: !i.active }))}
                  disabled={busy}
                  className="btn btn-sm"
                  title={i.active ? 'Desactivar' : 'Reactivar'}
                >
                  <Power className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`¿Eliminar el insumo "${i.name}"?`)) void run(() => api.delete(`/inventory/ingredients/${i.id}`));
                  }}
                  disabled={busy}
                  className="btn btn-sm btn-danger"
                  title="Eliminar (solo si no está en recetas)"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {historyFor === i.id && (
              <div className="mt-3 border-t border-border pt-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">Últimos movimientos</p>
                {moves[i.id] == null ? (
                  <Skeleton className="h-10" />
                ) : moves[i.id]!.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin movimientos todavía.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {moves[i.id]!.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <Badge tone={m.type === 'WASTE' ? 'error' : m.type === 'SALE' ? 'neutral' : 'info'}>
                            {MOVE_LABEL[m.type]}
                          </Badge>
                          <span className="text-muted-foreground">
                            {new Date(m.createdAt).toLocaleString()} {m.reason ? `· ${m.reason}` : ''}
                          </span>
                        </span>
                        <span
                          className={`tabular font-semibold ${Number(m.quantityDelta) < 0 ? 'text-error' : 'text-ok'}`}
                        >
                          {Number(m.quantityDelta) > 0 ? '+' : ''}
                          {Number(m.quantityDelta)} {i.unit}
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
    </div>
  );
}

// ============================================================== RECETAS

function RecipesTab({ branchId }: { branchId: string }) {
  const [products, setProducts] = useState<MenuItemLite[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [productId, setProductId] = useState('');
  const [recipe, setRecipe] = useState<RecipeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pickIngredient, setPickIngredient] = useState('');
  const [qty, setQty] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<MenuItemLite[]>('/menu/items', { query: { branchId } }),
      api.get<Ingredient[]>('/inventory/ingredients', { query: { branchId } }),
    ])
      .then(([its, ings]) => {
        const real = its.filter((i) => !i.isCombo);
        setProducts(real);
        setIngredients(ings.filter((i) => i.active));
        const first = real[0];
        if (first) setProductId((p) => p || first.id);
      })
      .catch((err) => setError((err as ApiError).message));
  }, [branchId]);

  const loadRecipe = useCallback(async () => {
    if (!productId) return;
    try {
      setRecipe(await api.get<RecipeRow[]>(`/inventory/recipe/${productId}`));
    } catch (err) {
      setError((err as ApiError).message);
      setRecipe([]);
    }
  }, [productId]);

  useEffect(() => {
    void loadRecipe();
  }, [loadRecipe]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await loadRecipe();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty);
    if (!pickIngredient || !Number.isFinite(q) || q <= 0) return;
    void run(async () => {
      await api.put(`/inventory/recipe/${productId}`, { ingredientId: pickIngredient, quantity: q });
      setPickIngredient('');
      setQty('');
    });
  }

  if (products.length === 0) {
    return (
      <EmptyState icon={Boxes} title="Esta sucursal no tiene productos" description="Cargá productos en el Menú para poder definir sus recetas." />
    );
  }

  return (
    <div>
      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <label className="mb-4 block max-w-md space-y-1 text-sm">
        <span className="text-muted-foreground">Producto</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input w-full">
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="card p-4">
        <p className="mb-3 font-heading font-medium text-foreground">Insumos que consume una unidad</p>

        {recipe === null && <Skeleton className="h-16" />}
        {recipe?.length === 0 && (
          <p className="mb-3 text-sm text-muted-foreground">Todavía no tiene receta — agregá insumos abajo.</p>
        )}

        <ul className="mb-4 space-y-1.5">
          {recipe?.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm text-foreground">
                {r.ingredient.name}
                {!r.ingredient.active && <span className="ml-1 text-xs text-muted-foreground">(insumo inactivo)</span>}
              </span>
              <span className="tabular shrink-0 text-sm text-muted-foreground">
                {Number(r.quantity)} {r.ingredient.unit}
              </span>
              <button
                onClick={() => void run(() => api.delete(`/inventory/recipe/${productId}/${r.ingredientId}`))}
                disabled={busy}
                className="btn btn-ghost btn-icon h-8 w-8 shrink-0"
                aria-label={`Quitar ${r.ingredient.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1 text-sm">
            <span className="text-muted-foreground">Insumo</span>
            <select value={pickIngredient} onChange={(e) => setPickIngredient(e.target.value)} className="input w-full" required>
              <option value="">Elegí un insumo…</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Cantidad</span>
            <input type="number" min={0} step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className="input tabular w-28" required />
          </label>
          <button disabled={busy || !pickIngredient} className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Agregar / actualizar
          </button>
        </form>
        {ingredients.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">No hay insumos activos — cargalos en la pestaña Insumos primero.</p>
        )}
      </div>
    </div>
  );
}
