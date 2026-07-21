'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Skeleton } from './ui';

/**
 * ABM de un combo (crear / editar) en un drawer aparte — mismo patrón que
 * `modifier-manager.tsx`, para no seguir inflando `admin/menu/page.tsx` (que ya
 * maneja categorías + productos + estaciones + imágenes).
 *
 * Un combo es un bundle de productos a precio fijo. El "component builder" son
 * filas producto + cantidad; el backend exige entre 1 y 20 componentes y que
 * ninguno sea a su vez un combo (por eso el picker sólo lista no-combos).
 */

type PickItem = { id: string; name: string; price: string; isCombo: boolean; active: boolean };

type ComboComponent = {
  id: string;
  quantity: number;
  component: { id: string; name: string; price: string };
};

export type Combo = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  categoryId: string | null;
  stationId: string | null;
  active: boolean;
  isCombo: true;
  comboComponents: ComboComponent[];
};

/** Fila del builder — se guarda como string para atarla directo a los inputs. */
type ComponentRow = { menuItemId: string; quantity: string };

const MAX_COMPONENTS = 20;

function newRow(): ComponentRow {
  return { menuItemId: '', quantity: '1' };
}

export function ComboManager({
  branchId,
  countryCode,
  categories,
  stations,
  combo,
  onClose,
  onSaved,
}: {
  branchId: string;
  countryCode: string;
  categories: { id: string; name: string }[];
  /** Estaciones ya con su label resuelto (STATION_LABELS) desde la página. */
  stations: { id: string; label: string }[];
  /** `null` = crear; un combo = editar (prefill incl. componentes). */
  combo: Combo | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = combo !== null;

  const [items, setItems] = useState<PickItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(combo?.name ?? '');
  const [price, setPrice] = useState(combo?.price ?? '');
  const [description, setDescription] = useState(combo?.description ?? '');
  const [categoryId, setCategoryId] = useState(combo?.categoryId ?? '');
  const [stationId, setStationId] = useState(combo?.stationId ?? '');
  const [rows, setRows] = useState<ComponentRow[]>(
    combo && combo.comboComponents.length > 0
      ? combo.comboComponents.map((c) => ({ menuItemId: c.component.id, quantity: String(c.quantity) }))
      : [newRow()],
  );

  // Candidatos del picker: sólo productos activos y NO-combos (un combo no puede
  // contener otro combo — el backend lo rechaza con 400).
  const loadItems = useCallback(async () => {
    try {
      const data = await api.get<PickItem[]>('/menu/items', { query: { branchId } });
      setItems(data.filter((i) => !i.isCombo && i.active));
    } catch (err) {
      setError((err as ApiError).message);
      setItems([]);
    }
  }, [branchId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  function addRow() {
    setRows((r) => (r.length >= MAX_COMPONENTS ? r : [...r, newRow()]));
  }

  function removeRow(idx: number) {
    setRows((r) => (r.length <= 1 ? r : r.filter((_, i) => i !== idx)));
  }

  function patchRow(idx: number, patch: Partial<ComponentRow>) {
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }

  // Filas usables para el hint y el submit: producto elegido + cantidad válida.
  const validRows = useMemo(
    () => rows.filter((r) => r.menuItemId && Number(r.quantity) >= 1),
    [rows],
  );

  const componentsSum = useMemo(
    () =>
      validRows.reduce((acc, r) => {
        const it = items?.find((i) => i.id === r.menuItemId);
        return acc + (it ? Number(it.price) * Number(r.quantity) : 0);
      }, 0),
    [validRows, items],
  );

  const priceNum = Number(price);
  const priceValid = price.trim() !== '' && Number.isFinite(priceNum) && priceNum >= 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 120) {
      setError('El nombre del combo tiene que tener entre 2 y 120 caracteres.');
      return;
    }
    if (!priceValid) {
      setError('Cargá un precio válido (0 o más).');
      return;
    }
    if (validRows.length < 1) {
      setError('Un combo necesita al menos un producto. Agregá un componente.');
      return;
    }
    if (validRows.length > MAX_COMPONENTS) {
      setError(`Un combo puede tener hasta ${MAX_COMPONENTS} componentes.`);
      return;
    }
    for (const r of validRows) {
      const q = Number(r.quantity);
      if (!Number.isInteger(q) || q < 1 || q > 50) {
        setError('Cada componente tiene que llevar una cantidad entre 1 y 50.');
        return;
      }
    }

    const components = validRows.map((r) => ({ menuItemId: r.menuItemId, quantity: Number(r.quantity) }));

    setBusy(true);
    try {
      if (isEdit && combo) {
        // PATCH: mandamos `null` explícito para limpiar categoría/estación (igual
        // criterio que el editor de productos). `components` reemplaza toda la lista.
        await api.patch(`/menu/combos/${combo.id}`, {
          name: trimmedName,
          description: description.trim() || null,
          price: priceNum,
          categoryId: categoryId || null,
          stationId: stationId || null,
          components,
        });
      } else {
        await api.post('/menu/combos', {
          branchId,
          categoryId: categoryId || undefined,
          stationId: stationId || undefined,
          name: trimmedName,
          description: description.trim() || undefined,
          price: priceNum,
          components,
        });
      }
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose} role="presentation">
      <form
        onSubmit={onSubmit}
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-surface p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Editar combo ${combo?.name}` : 'Nuevo combo'}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {isEdit ? 'Editar combo' : 'Nuevo combo'}
            </h2>
            <p className="text-sm text-muted-foreground">
              Un combo junta varios productos y se vende a un precio fijo.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <Alert tone="error" className="mb-4 mt-3">
            {error}
          </Alert>
        )}

        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="combo-name" className="label mb-1.5">
              Nombre
            </label>
            <input
              id="combo-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Combo Berry (hamburguesa + papas + refresco)"
              maxLength={120}
              required
              className="input w-full"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="combo-price" className="label mb-1.5">
                Precio del combo
              </label>
              <input
                id="combo-price"
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Precio"
                required
                className="input tabular w-full"
              />
            </div>
            <div className="min-w-0 flex-1">
              <label htmlFor="combo-category" className="label mb-1.5">
                Categoría (opcional)
              </label>
              <select
                id="combo-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="input w-full"
              >
                <option value="">Sin categoría</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="combo-station" className="label mb-1.5">
              Estación de cocina (opcional)
            </label>
            <select
              id="combo-station"
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              className="input w-full"
            >
              <option value="">Sin estación</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="combo-description" className="label mb-1.5">
              Descripción (opcional)
            </label>
            <textarea
              id="combo-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Lo que ve el comensal debajo del nombre."
              rows={2}
              className="input w-full"
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-heading text-sm font-semibold text-foreground">Productos del combo</p>
            <span className="text-xs text-muted-foreground">
              {validRows.length}/{MAX_COMPONENTS}
            </span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Elegí los productos que entran y cuántos de cada uno. Los combos no se pueden anidar dentro de otro combo.
          </p>

          {items === null ? (
            <div className="space-y-2">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : items.length === 0 ? (
            <Alert tone="info" className="mb-3">
              No hay productos sueltos en esta sucursal todavía. Cargá productos en el menú antes de armar un combo.
            </Alert>
          ) : (
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <select
                    value={row.menuItemId}
                    onChange={(e) => patchRow(idx, { menuItemId: e.target.value })}
                    className="input min-w-0 flex-1"
                    aria-label={`Producto del componente ${idx + 1}`}
                  >
                    <option value="">Elegí un producto...</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} · {formatMoney(Number(it.price), countryCode)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={row.quantity}
                    onChange={(e) => patchRow(idx, { quantity: e.target.value })}
                    className="input tabular w-20"
                    aria-label={`Cantidad del componente ${idx + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length <= 1}
                    className="btn btn-ghost btn-icon shrink-0"
                    aria-label={`Quitar el componente ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addRow}
                disabled={rows.length >= MAX_COMPONENTS}
                className="btn btn-sm"
              >
                <Plus className="h-4 w-4" />
                Agregar componente
              </button>
            </div>
          )}

          {validRows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Los componentes sueltos suman{' '}
              <span className="tabular font-medium text-foreground">{formatMoney(componentsSum, countryCode)}</span>
              {priceValid && (
                <>
                  ; tu combo cuesta{' '}
                  <span className="tabular font-medium text-foreground">{formatMoney(priceNum, countryCode)}</span>
                  {priceNum < componentsSum
                    ? ` (ahorro de ${formatMoney(componentsSum - priceNum, countryCode)}).`
                    : '.'}
                </>
              )}
            </p>
          )}
        </div>

        <div className="mt-6 flex gap-2">
          <button type="submit" disabled={busy || items === null} className="btn btn-primary flex-1">
            {busy ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear combo'}
          </button>
          <button type="button" onClick={onClose} className="btn flex-1">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
