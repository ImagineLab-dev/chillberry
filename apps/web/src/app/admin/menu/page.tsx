'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ImageOff, Package, Pencil, Plus, Settings2, Tags, UtensilsCrossed } from 'lucide-react';
import { STATION_LABELS, formatMoney, type StationType } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { ModifierManager } from '@/components/modifier-manager';
import { ComboManager, type Combo } from '@/components/combo-manager';

// Fallback mientras `/tenant-settings` todavía no respondió (fetch en el primer
// useEffect, ver más abajo) — no debe llegar `undefined` a formatMoney.
const FALLBACK_COUNTRY_CODE = 'PY';

type TenantSettings = { id: string; name: string; countryCode: string; currency: string; timezone: string };

type Branch = { id: string; name: string };
type Category = { id: string; name: string; sortOrder: number; active: boolean; branchId: string };
type Station = { id: string; type: StationType; name: string };
type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  // Precio para delivery (Decimal string) o null = igual al base.
  deliveryPrice: string | null;
  // Costo de producción (food cost). `null` = no cargado. Solo admin — nunca
  // se muestra al comensal. Es un Decimal, viaja como string igual que `price`.
  cost: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  stationId: string | null;
  // "86": agotado por hoy (temporal, distinto de `active`).
  soldOut: boolean;
  sortOrder: number;
  active: boolean;
};

type ItemEditForm = {
  name: string;
  description: string;
  price: string;
  deliveryPrice: string;
  cost: string;
  categoryId: string;
  stationId: string;
  imageUrl: string;
};

const EMPTY_ITEM_EDIT: ItemEditForm = {
  name: '',
  description: '',
  price: '',
  deliveryPrice: '',
  cost: '',
  categoryId: '',
  stationId: '',
  imageUrl: '',
};

/**
 * Margen de un producto a partir de precio y costo (ambos Decimal string).
 * `null` cuando no hay costo cargado o el precio no es un número usable.
 * Margen $ = precio − costo; margen % = (precio − costo) / precio × 100.
 */
function itemMargin(item: MenuItem): { amount: number; pct: number } | null {
  if (item.cost == null) return null;
  const price = Number(item.price);
  const cost = Number(item.cost);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(cost)) return null;
  const amount = price - cost;
  return { amount, pct: (amount / price) * 100 };
}

/** Salud del margen: sano ≥60%, flaco 30–60%, riesgo <30% o negativo. */
function marginTone(pct: number): 'ok' | 'warn' | 'error' {
  if (pct >= 60) return 'ok';
  if (pct >= 30) return 'warn';
  return 'error';
}

/**
 * Badge de rentabilidad en la tarjeta del producto — SOLO admin, nunca se
 * renderiza en la superficie del comensal. Sin costo cargado muestra un badge
 * neutro que invita a cargarlo (es un dato que le falta al dueño).
 */
function MarginBadge({ item }: { item: MenuItem }) {
  const margin = itemMargin(item);
  if (!margin) {
    return <Badge tone="neutral">Sin costo</Badge>;
  }
  return (
    <Badge tone={marginTone(margin.pct)} className="tabular">
      Margen {Math.round(margin.pct)}%
    </Badge>
  );
}

export default function MenuPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const countryCode = tenantSettings?.countryCode ?? FALLBACK_COUNTRY_CODE;
  const [categories, setCategories] = useState<Category[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  // Carga inicial de categorías + estaciones + productos. Mismo criterio que los
  // combos (más abajo, vía `combosError`): un GET fallido/lento no debe verse
  // como "cuenta vacía" — mostramos skeleton mientras carga y el error si falla.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [categoryName, setCategoryName] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemDeliveryPrice, setItemDeliveryPrice] = useState('');
  const [itemCost, setItemCost] = useState('');
  // Búsqueda de la carta (filtra la lista de productos por nombre/descripción).
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [stationId, setStationId] = useState('');
  const [itemImageUrl, setItemImageUrl] = useState('');
  const [itemFileInputKey, setItemFileInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edición inline de categorías: solo el nombre (ver spec — sortOrder no se edita acá).
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');

  // Edición inline de productos: reemplaza el contenido de la tarjeta por un formulario.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemEdit, setItemEdit] = useState<ItemEditForm>(EMPTY_ITEM_EDIT);
  const [itemEditUploading, setItemEditUploading] = useState(false);
  const [itemEditUploadError, setItemEditUploadError] = useState<string | null>(null);

  // Producto cuyo ABM de opciones/extras está abierto (drawer aparte).
  const [modifiersFor, setModifiersFor] = useState<MenuItem | null>(null);

  // Combos: `null` mientras carga (skeleton). El drawer de crear/editar vive
  // aparte en `combo-manager.tsx`.
  const [combos, setCombos] = useState<Combo[] | null>(null);
  const [combosError, setCombosError] = useState<string | null>(null);
  const [comboModal, setComboModal] = useState<{ mode: 'create' } | { mode: 'edit'; combo: Combo } | null>(null);

  async function loadBranches() {
    const b = await api.get<Branch[]>('/branches');
    setBranches(b);
    if (!branchId && b[0]) setBranchId(b[0].id);
    return b;
  }

  async function loadMenu(forBranchId: string) {
    if (!forBranchId) return;
    const [c, s, i] = await Promise.all([
      api.get<Category[]>('/menu/categories', { query: { branchId: forBranchId } }),
      api.get<Station[]>('/kitchen/stations', { query: { branchId: forBranchId } }),
      api.get<MenuItem[]>('/menu/items', { query: { branchId: forBranchId, includeInactive: true } }),
    ]);
    setCategories(c);
    setStations(s);
    setItems(i);
  }

  useEffect(() => {
    loadBranches()
      .then((b) => {
        // Sin sucursales no corre loadMenu (corta con branchId vacío): cerramos
        // el loading acá para mostrar el estado vacío en vez de un skeleton.
        if (b.length === 0) setLoading(false);
      })
      .catch((err) => {
        setLoadError((err as ApiError).message);
        setLoading(false);
      });
    api
      .get<TenantSettings>('/tenant-settings')
      .then(setTenantSettings)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCombos(forBranchId: string) {
    if (!forBranchId) return;
    setCombosError(null);
    try {
      const c = await api.get<Combo[]>('/menu/combos', {
        query: { branchId: forBranchId, includeInactive: true },
      });
      setCombos(c);
    } catch (err) {
      setCombosError((err as ApiError).message);
      setCombos([]);
    }
  }

  useEffect(() => {
    setCombos(null);
    loadCombos(branchId).catch(() => {});
    if (!branchId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadMenu(branchId)
      .catch((err) => {
        if (!cancelled) setLoadError((err as ApiError).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  async function onCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/menu/categories', { branchId, name: categoryName });
      setCategoryName('');
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  function startEditCategory(c: Category) {
    setEditingCategoryId(c.id);
    setEditCategoryName(c.name);
  }

  function cancelEditCategory() {
    setEditingCategoryId(null);
    setEditCategoryName('');
  }

  async function onSaveCategory(id: string) {
    setError(null);
    try {
      await api.patch(`/menu/categories/${id}`, { name: editCategoryName });
      cancelEditCategory();
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function onToggleCategoryActive(c: Category) {
    setError(null);
    try {
      if (c.active) {
        await api.delete(`/menu/categories/${c.id}`);
      } else {
        await api.patch(`/menu/categories/${c.id}`, { active: true });
      }
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function onItemImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      setItemImageUrl(url);
    } catch (err) {
      setUploadError((err as ApiError).message);
    } finally {
      setUploading(false);
    }
  }

  async function onCreateItem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/menu/items', {
        branchId,
        categoryId: categoryId || undefined,
        stationId: stationId || undefined,
        name: itemName,
        description: itemDescription || undefined,
        price: Number(itemPrice),
        // Precio delivery: sólo si cargó algo; vacío = mismo precio en todos los canales.
        deliveryPrice: itemDeliveryPrice.trim() ? Number(itemDeliveryPrice) : undefined,
        // Solo mandamos el costo si el usuario cargó algo: vacío = no tocar el
        // campo (queda sin costo). No usamos `Number('')` que daría 0.
        cost: itemCost.trim() ? Number(itemCost) : undefined,
        imageUrl: itemImageUrl || undefined,
      });
      setItemName('');
      setItemDescription('');
      setItemPrice('');
      setItemDeliveryPrice('');
      setItemCost('');
      setItemImageUrl('');
      setUploadError(null);
      setItemFileInputKey((k) => k + 1);
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  function startEditItem(i: MenuItem) {
    setEditingItemId(i.id);
    setItemEdit({
      name: i.name,
      description: i.description ?? '',
      price: i.price,
      deliveryPrice: i.deliveryPrice ?? '',
      cost: i.cost ?? '',
      categoryId: i.categoryId ?? '',
      stationId: i.stationId ?? '',
      imageUrl: i.imageUrl ?? '',
    });
    setItemEditUploadError(null);
  }

  function cancelEditItem() {
    setEditingItemId(null);
    setItemEdit(EMPTY_ITEM_EDIT);
    setItemEditUploadError(null);
  }

  async function onItemEditImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setItemEditUploadError(null);
    setItemEditUploading(true);
    try {
      const { url } = await api.uploadImage(file);
      setItemEdit((prev) => ({ ...prev, imageUrl: url }));
    } catch (err) {
      setItemEditUploadError((err as ApiError).message);
    } finally {
      setItemEditUploading(false);
    }
  }

  async function onSaveItemEdit(id: string) {
    setError(null);
    try {
      // `null` (no `undefined`) para categoría/estación/imagen: a diferencia
      // de crear un producto nuevo, acá "Sin categoría" puede significar
      // "sacale la categoría que ya tenía" — mandar `undefined` se
      // serializa fuera del body y el backend lo interpreta como "no tocar
      // este campo", dejando la categoría vieja pegada. La API ya acepta
      // `null` explícito para estos tres campos (ver UpdateMenuItemDto).
      await api.patch(`/menu/items/${id}`, {
        name: itemEdit.name,
        description: itemEdit.description,
        price: Number(itemEdit.price),
        // Vacío → null: limpia el precio delivery (vuelve a usar el base).
        deliveryPrice: itemEdit.deliveryPrice.trim() ? Number(itemEdit.deliveryPrice) : null,
        // Igual que categoría/estación: mandamos `null` explícito si el usuario
        // vació el campo, para LIMPIAR el costo cargado (la API acepta null).
        // Con valor, el número; el backend lo interpreta como el costo nuevo.
        cost: itemEdit.cost.trim() ? Number(itemEdit.cost) : null,
        categoryId: itemEdit.categoryId || null,
        stationId: itemEdit.stationId || null,
        imageUrl: itemEdit.imageUrl || null,
      });
      cancelEditItem();
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function onToggleItemActive(i: MenuItem) {
    setError(null);
    try {
      if (i.active) {
        await api.delete(`/menu/items/${i.id}`);
      } else {
        await api.patch(`/menu/items/${i.id}`, { active: true });
      }
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  // "86": marcar/desmarcar agotado por hoy (temporal, no da de baja el producto).
  async function onToggleSoldOut(i: MenuItem) {
    setError(null);
    try {
      await api.patch(`/menu/items/${i.id}`, { soldOut: !i.soldOut });
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  // Reordenar: intercambia el producto con su vecino (arriba/abajo) DENTRO de la
  // vista filtrada actual, y manda la lista completa reordenada al backend.
  async function onReorderItem(i: MenuItem, dir: -1 | 1) {
    const list = visibleItems;
    const idx = list.findIndex((x) => x.id === i.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const reordered = [...list];
    [reordered[idx], reordered[target]] = [reordered[target]!, reordered[idx]!];
    // Optimista: refleja el nuevo orden al instante.
    const ids = new Set(reordered.map((x) => x.id));
    setItems((prev) => [...reordered, ...prev.filter((x) => !ids.has(x.id))]);
    setError(null);
    try {
      await api.patch('/menu/items/reorder', { branchId, orderedIds: reordered.map((x) => x.id) });
      await loadMenu(branchId);
    } catch (err) {
      setError((err as ApiError).message);
      await loadMenu(branchId);
    }
  }

  // Desactivar (DELETE, soft delete) / Reactivar (PATCH active:true) — mismo
  // criterio de toggle que categorías y productos.
  async function onToggleComboActive(c: Combo) {
    setCombosError(null);
    try {
      if (c.active) {
        await api.delete(`/menu/combos/${c.id}`);
      } else {
        await api.patch(`/menu/combos/${c.id}`, { active: true });
      }
      await loadCombos(branchId);
    } catch (err) {
      setCombosError((err as ApiError).message);
    }
  }

  const stationLabel = (id: string | null) => {
    const station = stations.find((s) => s.id === id);
    return station ? STATION_LABELS[station.type] : 'Sin estación';
  };

  // "1× Hamburguesa · 1× Papas · 1× Refresco"
  const comboSummary = (c: Combo) =>
    c.comboComponents.map((cc) => `${cc.quantity}× ${cc.component.name}`).join(' · ');

  // Lista visible: `items` ya viene ordenada por `sortOrder` del backend; se
  // filtra por la búsqueda (nombre/descripción). El reordenar sólo se ofrece
  // sin búsqueda activa (reordenar un subconjunto filtrado no tendría sentido).
  const searchTerm = search.trim().toLowerCase();
  const visibleItems = searchTerm
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(searchTerm) ||
          (i.description ?? '').toLowerCase().includes(searchTerm),
      )
    : items;

  return (
    <div>
      <PageHeader title="Menú" description="Las categorías y los productos que ve el comensal al escanear el QR." />

      <div className="mb-6">
        <label htmlFor="menu-branch" className="label mb-1.5">
          Sucursal
        </label>
        <select
          id="menu-branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="input w-full sm:w-64"
        >
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

      {loadError && !loading && (
        <Alert tone="error" className="mb-4">
          {loadError}
        </Alert>
      )}

      {/* Apiladas a lo ancho completo (antes lado a lado 1fr/2fr): con pocas
          categorías la columna izquierda quedaba corta y dejaba un hueco grande,
          y los productos apretados en 2/3. Ahora cada sección usa todo el ancho. */}
      <div className="mb-8 space-y-8">
        <div className="min-w-0 max-w-2xl">
          <h2 className="mb-2 font-heading text-lg font-semibold">Categorías</h2>
          <form onSubmit={onCreateCategory} className="mb-3 flex gap-2">
            <input
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="Nombre de categoría"
              required
              className="input min-w-0 flex-1"
            />
            <button className="btn btn-primary shrink-0">
              <Plus className="h-4 w-4" />
              Agregar
            </button>
          </form>
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          <ul className="space-y-2 text-sm">
            {categories.map((c) => (
              <li
                key={c.id}
                className={`card card-dense flex items-center justify-between gap-3 px-3 py-2 ${c.active ? '' : 'opacity-60'}`}
              >
                {editingCategoryId === c.id ? (
                  <>
                    <input
                      value={editCategoryName}
                      onChange={(e) => setEditCategoryName(e.target.value)}
                      className="input min-w-0 flex-1"
                      autoFocus
                    />
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => onSaveCategory(c.id)} className="btn btn-primary btn-sm">
                        Guardar
                      </button>
                      <button type="button" onClick={cancelEditCategory} className="btn btn-sm">
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{c.name}</span>
                      {!c.active && <Badge tone="error">Inactiva</Badge>}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => startEditCategory(c)} className="btn btn-sm">
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button type="button" onClick={() => onToggleCategoryActive(c)} className="btn btn-sm">
                        {c.active ? 'Desactivar' : 'Reactivar'}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!loading && !loadError && categories.length === 0 && (
            <EmptyState
              icon={Tags}
              title="Sin categorías todavía"
              description="Agrupá tus productos (Entradas, Bebidas, Postres...) para que el menú se lea fácil."
            />
          )}
        </div>

        <div className="min-w-0">
          <h2 className="mb-2 font-heading text-lg font-semibold">Productos</h2>
          <form onSubmit={onCreateItem} className="panel mb-4 flex flex-col gap-2 p-4">
            <div className="flex flex-wrap gap-2">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="input w-full sm:w-44"
                aria-label="Categoría"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                className="input w-full sm:w-48"
                aria-label="Estación de cocina"
              >
                <option value="">Estación de cocina...</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {STATION_LABELS[s.type]}
                  </option>
                ))}
              </select>
              <input
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Nombre del producto"
                required
                className="input w-full min-w-0 sm:flex-1"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={itemPrice}
                onChange={(e) => setItemPrice(e.target.value)}
                placeholder="Precio"
                required
                aria-label="Precio"
                className="input tabular w-full sm:w-28"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={itemDeliveryPrice}
                onChange={(e) => setItemDeliveryPrice(e.target.value)}
                placeholder="Precio delivery"
                aria-label="Precio para delivery (opcional)"
                title="Precio para pedidos de delivery. Vacío = mismo precio que en salón."
                className="input tabular w-full sm:w-32"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={itemCost}
                onChange={(e) => setItemCost(e.target.value)}
                placeholder="Costo (opcional)"
                aria-label="Costo de producción (opcional)"
                className="input tabular w-full sm:w-32"
              />
            </div>
            <textarea
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              placeholder="Descripción (opcional)"
              rows={2}
              className="input w-full"
            />
            <div className="flex flex-wrap items-center gap-3">
              <input
                key={itemFileInputKey}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onItemImageChange}
                className="text-xs"
              />
              {uploading && <span className="text-xs text-muted-foreground">Subiendo imagen...</span>}
              {itemImageUrl && !uploading && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={itemImageUrl} alt="Vista previa" className="h-12 w-12 rounded-md object-cover" />
              )}
            </div>
            {uploadError && <p className="text-xs text-error-foreground">{uploadError}</p>}
            <button className="btn btn-primary self-start" disabled={uploading}>
              <Plus className="h-4 w-4" />
              Agregar producto
            </button>
          </form>

          {loading && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
              <Skeleton className="h-72" />
            </div>
          )}
          {items.length > 0 && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              aria-label="Buscar en la carta"
              className="input mb-4 w-full sm:max-w-xs"
            />
          )}
          {searchTerm && visibleItems.length === 0 && (
            <p className="mb-4 text-sm text-muted-foreground">Ningún producto coincide con “{search}”.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleItems.map((i, idx) => (
              <div
                key={i.id}
                className={`card flex flex-col p-4 ${i.active ? '' : 'opacity-60'} ${i.soldOut ? 'ring-1 ring-warn' : ''}`}
              >
                {editingItemId === i.id ? (
                  <div className="flex flex-col gap-2">
                    <input
                      value={itemEdit.name}
                      onChange={(e) => setItemEdit((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Nombre"
                      required
                      className="input w-full"
                    />
                    <textarea
                      value={itemEdit.description}
                      onChange={(e) => setItemEdit((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="Descripción (opcional)"
                      rows={2}
                      className="input w-full"
                    />
                    <div className="flex gap-2">
                      <select
                        value={itemEdit.categoryId}
                        onChange={(e) => setItemEdit((prev) => ({ ...prev, categoryId: e.target.value }))}
                        className="input min-w-0 flex-1"
                        aria-label="Categoría"
                      >
                        <option value="">Sin categoría</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={itemEdit.stationId}
                        onChange={(e) => setItemEdit((prev) => ({ ...prev, stationId: e.target.value }))}
                        className="input min-w-0 flex-1"
                        aria-label="Estación de cocina"
                      >
                        <option value="">Estación de cocina...</option>
                        {stations.map((s) => (
                          <option key={s.id} value={s.id}>
                            {STATION_LABELS[s.type]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={itemEdit.price}
                        onChange={(e) => setItemEdit((prev) => ({ ...prev, price: e.target.value }))}
                        placeholder="Precio"
                        required
                        aria-label="Precio"
                        className="input tabular min-w-0 flex-1"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={itemEdit.deliveryPrice}
                        onChange={(e) => setItemEdit((prev) => ({ ...prev, deliveryPrice: e.target.value }))}
                        placeholder="Precio delivery"
                        aria-label="Precio para delivery (opcional)"
                        title="Vacío = mismo precio que en salón."
                        className="input tabular min-w-0 flex-1"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={itemEdit.cost}
                        onChange={(e) => setItemEdit((prev) => ({ ...prev, cost: e.target.value }))}
                        placeholder="Costo (opcional)"
                        aria-label="Costo de producción (opcional)"
                        className="input tabular min-w-0 flex-1"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={onItemEditImageChange}
                        className="text-xs"
                      />
                      {itemEditUploading && (
                        <span className="text-xs text-muted-foreground">Subiendo imagen...</span>
                      )}
                      {itemEdit.imageUrl && !itemEditUploading && (
                        <button
                          type="button"
                          onClick={() => setItemEdit((prev) => ({ ...prev, imageUrl: '' }))}
                          className="btn btn-sm"
                        >
                          Quitar foto
                        </button>
                      )}
                    </div>
                    {itemEdit.imageUrl && !itemEditUploading && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={itemEdit.imageUrl} alt="Vista previa" className="h-20 w-20 rounded-md object-cover" />
                    )}
                    {itemEditUploadError && <p className="text-xs text-error-foreground">{itemEditUploadError}</p>}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => onSaveItemEdit(i.id)}
                        disabled={itemEditUploading}
                        className="btn btn-primary btn-sm flex-1"
                      >
                        Guardar
                      </button>
                      <button type="button" onClick={cancelEditItem} className="btn btn-sm flex-1">
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {i.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.imageUrl} alt={i.name} className="mb-3 h-32 w-full rounded-md object-cover" />
                    ) : (
                      <div className="mb-3 flex h-32 w-full flex-col items-center justify-center gap-1 rounded-md bg-muted text-xs text-muted-foreground">
                        <ImageOff className="h-5 w-5" />
                        Sin foto
                      </div>
                    )}
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-heading font-medium text-foreground">{i.name}</span>
                      <Badge tone="primary" className="tabular shrink-0">
                        {formatMoney(i.price, countryCode)}
                      </Badge>
                    </div>
                    {i.description && <p className="mb-2 text-xs text-muted-foreground">{i.description}</p>}
                    {i.deliveryPrice && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        Delivery: <span className="tabular">{formatMoney(i.deliveryPrice, countryCode)}</span>
                      </p>
                    )}
                    <div className="mb-3 flex flex-wrap gap-2">
                      <Badge tone="info">{stationLabel(i.stationId)}</Badge>
                      <Badge tone={i.active ? 'ok' : 'error'} dot>
                        {i.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                      {i.soldOut && (
                        <Badge tone="warn" dot>
                          Agotado
                        </Badge>
                      )}
                      <MarginBadge item={i} />
                    </div>
                    <div className="mt-auto space-y-2">
                      <div className="flex gap-2">
                        {/* Reordenar sólo sin búsqueda activa (mueve dentro de la
                            lista completa). "86" prende/apaga agotado por hoy. */}
                        {!searchTerm && (
                          <>
                            <button
                              type="button"
                              onClick={() => onReorderItem(i, -1)}
                              disabled={idx === 0}
                              className="btn btn-sm px-2"
                              aria-label={`Subir ${i.name}`}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onReorderItem(i, 1)}
                              disabled={idx === visibleItems.length - 1}
                              className="btn btn-sm px-2"
                              aria-label={`Bajar ${i.name}`}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleSoldOut(i)}
                          className={`btn btn-sm flex-1 ${i.soldOut ? 'btn-primary' : ''}`}
                        >
                          {i.soldOut ? 'Marcar disponible' : 'Marcar agotado'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setModifiersFor(i)}
                        className="btn btn-sm w-full"
                        aria-label={`Opciones y extras de ${i.name}`}
                      >
                        <Settings2 className="h-4 w-4" />
                        Opciones y extras
                      </button>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => startEditItem(i)} className="btn btn-sm flex-1">
                          <Pencil className="h-4 w-4" />
                          Editar
                        </button>
                        <button type="button" onClick={() => onToggleItemActive(i)} className="btn btn-sm flex-1">
                          {i.active ? 'Desactivar' : 'Reactivar'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          {!loading && !loadError && items.length === 0 && (
            <EmptyState
              icon={UtensilsCrossed}
              title="Todavía no cargaste ningún producto"
              description="Cargá tu primer plato o bebida acá arriba: nombre, precio y una foto. Eso es lo que va a ver el comensal."
            />
          )}
        </div>
      </div>

      <div className="mb-8 min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">Combos</h2>
            <p className="text-sm text-muted-foreground">
              Bundles de productos a precio fijo — ideal para promos (hamburguesa + papas + refresco).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setComboModal({ mode: 'create' })}
            className="btn btn-primary shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nuevo combo
          </button>
        </div>

        {combosError && (
          <Alert tone="error" className="mb-4">
            {combosError}
          </Alert>
        )}

        {combos === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : combos.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Todavía no armaste combos"
            description="Juntá varios productos en un solo precio: tocá “Nuevo combo”, elegí los productos y ponele un precio fijo."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {combos.map((c) => (
              <div key={c.id} className={`card flex flex-col p-4 ${c.active ? '' : 'opacity-60'}`}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-heading font-medium text-foreground">{c.name}</span>
                  <Badge tone="primary" className="tabular shrink-0">
                    {formatMoney(Number(c.price), countryCode)}
                  </Badge>
                </div>
                {c.description && <p className="mb-2 text-xs text-muted-foreground">{c.description}</p>}
                <p className="mb-3 text-sm text-muted-foreground">
                  {c.comboComponents.length > 0 ? comboSummary(c) : 'Sin productos cargados.'}
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge tone={c.active ? 'ok' : 'error'} dot>
                    {c.active ? 'Activo' : 'Inactivo'}
                  </Badge>
                </div>
                <div className="mt-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => setComboModal({ mode: 'edit', combo: c })}
                    className="btn btn-sm flex-1"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </button>
                  <button type="button" onClick={() => onToggleComboActive(c)} className="btn btn-sm flex-1">
                    {c.active ? 'Desactivar' : 'Reactivar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modifiersFor && (
        <ModifierManager
          menuItemId={modifiersFor.id}
          menuItemName={modifiersFor.name}
          countryCode={countryCode}
          onClose={() => setModifiersFor(null)}
        />
      )}

      {comboModal && (
        <ComboManager
          branchId={branchId}
          countryCode={countryCode}
          categories={categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))}
          stations={stations.map((s) => ({ id: s.id, label: STATION_LABELS[s.type] }))}
          combo={comboModal.mode === 'edit' ? comboModal.combo : null}
          onClose={() => setComboModal(null)}
          onSaved={() => {
            setComboModal(null);
            loadCombos(branchId).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
