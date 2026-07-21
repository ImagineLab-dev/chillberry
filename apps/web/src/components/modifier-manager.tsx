'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { Alert, Badge, EmptyState, Skeleton } from './ui';
import { Settings2 } from 'lucide-react';

type ModifierOption = { id: string; name: string; priceDelta: string; active: boolean };
type ModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  active: boolean;
  options: ModifierOption[];
};

/**
 * ABM de opciones/extras de un producto ("Extras", "Punto de cocción").
 *
 * Vive en un drawer aparte y no dentro de `admin/menu/page.tsx` a propósito:
 * esa página ya tiene ~590 líneas y maneja categorías + productos + estaciones
 * + imágenes.
 */
export function ModifierManager({
  menuItemId,
  menuItemName,
  countryCode,
  onClose,
}: {
  menuItemId: string;
  menuItemName: string;
  countryCode: string;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<ModifierGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [groupName, setGroupName] = useState('');
  const [groupMax, setGroupMax] = useState('1');
  const [groupRequired, setGroupRequired] = useState(false);

  // Formularios de opción, uno por grupo — un solo objeto en vez de estado por
  // grupo, así no hay que sincronizar N formularios.
  const [optionDraft, setOptionDraft] = useState<Record<string, { name: string; priceDelta: string }>>({});

  // Edición inline: un solo grupo / una sola opción editable a la vez.
  const [editGroup, setEditGroup] = useState<{ id: string; name: string; max: string; required: boolean } | null>(null);
  const [editOption, setEditOption] = useState<{ id: string; name: string; priceDelta: string } | null>(null);

  const load = useCallback(async () => {
    try {
      // includeInactive: el admin necesita ver los desactivados para poder
      // reactivarlos (si no, "Desactivar" era un pozo sin retorno). El camino
      // del comensal (QR) sigue viendo solo los activos, es otro endpoint.
      const data = await api.get<ModifierGroup[]>(`/menu/items/${menuItemId}/modifier-groups`, {
        query: { includeInactive: 'true' },
      });
      setGroups(data);
    } catch (err) {
      setError((err as ApiError).message);
      setGroups([]);
    }
  }, [menuItemId]);

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

  function onCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) return;
    const max = Number(groupMax) || 1;
    void run(async () => {
      await api.post(`/menu/items/${menuItemId}/modifier-groups`, {
        name: groupName.trim(),
        maxSelect: max,
        // Un grupo obligatorio sin mínimo no obligaría a nada.
        minSelect: groupRequired ? 1 : 0,
        required: groupRequired,
      });
      setGroupName('');
      setGroupMax('1');
      setGroupRequired(false);
    });
  }

  function onCreateOption(groupId: string) {
    const draft = optionDraft[groupId];
    if (!draft?.name.trim()) return;
    void run(async () => {
      await api.post(`/menu/modifier-groups/${groupId}/options`, {
        name: draft.name.trim(),
        priceDelta: Number(draft.priceDelta) || 0,
      });
      setOptionDraft((d) => ({ ...d, [groupId]: { name: '', priceDelta: '' } }));
    });
  }

  function onSaveGroup() {
    if (!editGroup || !editGroup.name.trim()) return;
    const max = Number(editGroup.max) || 1;
    const g = editGroup;
    void run(async () => {
      await api.patch(`/menu/modifier-groups/${g.id}`, {
        name: g.name.trim(),
        maxSelect: max,
        minSelect: g.required ? 1 : 0,
        required: g.required,
      });
      setEditGroup(null);
    });
  }

  function onSaveOption() {
    if (!editOption || !editOption.name.trim()) return;
    const o = editOption;
    void run(async () => {
      await api.patch(`/menu/modifier-options/${o.id}`, {
        name: o.name.trim(),
        priceDelta: Number(o.priceDelta) || 0,
      });
      setEditOption(null);
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose} role="presentation">
      <div
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-surface p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Opciones de ${menuItemName}`}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">Opciones y extras</h2>
            <p className="text-sm text-muted-foreground">{menuItemName}</p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-5 text-xs text-muted-foreground">
          Lo que definas acá lo elige el comensal desde el QR. El precio se suma solo al total.
        </p>

        {error && (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        )}

        <form onSubmit={onCreateGroup} className="card mb-5 space-y-3 p-4">
          <p className="font-heading text-sm font-semibold text-foreground">Nuevo grupo</p>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Nombre (ej: Extras, Punto de cocción)"
            maxLength={80}
            className="input w-full"
            aria-label="Nombre del grupo"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Máx. a elegir
              <input
                type="number"
                min={1}
                max={20}
                value={groupMax}
                onChange={(e) => setGroupMax(e.target.value)}
                className="input tabular w-20"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={groupRequired}
                onChange={(e) => setGroupRequired(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Obligatorio
            </label>
            <button type="submit" disabled={busy || !groupName.trim()} className="btn btn-primary btn-sm ml-auto">
              <Plus className="h-4 w-4" />
              Crear grupo
            </button>
          </div>
        </form>

        {groups === null && (
          <div className="space-y-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        )}

        {groups?.length === 0 && (
          <EmptyState
            icon={Settings2}
            title="Este producto no tiene opciones todavía"
            description="Creá un grupo arriba — por ejemplo “Extras” con queso o bacon, o “Punto de cocción” como opción obligatoria."
          />
        )}

        <div className="space-y-4">
          {groups?.map((group) => (
            <div key={group.id} className={`card p-4 ${group.active ? '' : 'opacity-60'}`}>
              {editGroup?.id === group.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSaveGroup();
                  }}
                  className="mb-3 space-y-2 border-b border-border pb-3"
                >
                  <input
                    value={editGroup.name}
                    onChange={(e) => setEditGroup((g) => (g ? { ...g, name: e.target.value } : g))}
                    maxLength={80}
                    className="input w-full"
                    aria-label="Nombre del grupo"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      Máx. a elegir
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={editGroup.max}
                        onChange={(e) => setEditGroup((g) => (g ? { ...g, max: e.target.value } : g))}
                        className="input tabular w-20"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={editGroup.required}
                        onChange={(e) => setEditGroup((g) => (g ? { ...g, required: e.target.checked } : g))}
                        className="h-4 w-4 accent-primary"
                      />
                      Obligatorio
                    </label>
                    <div className="ml-auto flex gap-1">
                      <button type="submit" disabled={busy || !editGroup.name.trim()} className="btn btn-primary btn-sm">
                        <Check className="h-4 w-4" />
                        Guardar
                      </button>
                      <button type="button" onClick={() => setEditGroup(null)} className="btn btn-ghost btn-sm">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </form>
              ) : (
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-heading font-medium text-foreground">{group.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {!group.active && <Badge tone="error">Desactivado</Badge>}
                      {group.required && <Badge tone="warn">Obligatorio</Badge>}
                      <Badge tone="neutral">
                        {group.maxSelect === 1 ? 'Elegir una' : `Hasta ${group.maxSelect}`}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {group.active && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditGroup({
                            id: group.id,
                            name: group.name,
                            max: String(group.maxSelect),
                            required: group.required,
                          })
                        }
                        disabled={busy}
                        className="btn btn-ghost btn-icon"
                        aria-label={`Editar el grupo ${group.name}`}
                        title="Editar grupo"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {group.active ? (
                      <button
                        type="button"
                        onClick={() => void run(() => api.delete(`/menu/modifier-groups/${group.id}`))}
                        disabled={busy}
                        className="btn btn-ghost btn-icon"
                        aria-label={`Desactivar el grupo ${group.name}`}
                        title="Desactivar grupo"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void run(() => api.patch(`/menu/modifier-groups/${group.id}`, { active: true }))}
                        disabled={busy}
                        className="btn btn-sm"
                        aria-label={`Reactivar el grupo ${group.name}`}
                        title="Reactivar grupo"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Reactivar
                      </button>
                    )}
                  </div>
                </div>
              )}

              <ul className="mb-3 space-y-1.5">
                {group.options.map((option) =>
                  editOption?.id === option.id ? (
                    <li key={option.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                      <input
                        value={editOption.name}
                        onChange={(e) => setEditOption((o) => (o ? { ...o, name: e.target.value } : o))}
                        maxLength={80}
                        className="input min-w-0 flex-1"
                        aria-label="Nombre de la opción"
                      />
                      <input
                        type="number"
                        value={editOption.priceDelta}
                        onChange={(e) => setEditOption((o) => (o ? { ...o, priceDelta: e.target.value } : o))}
                        className="input tabular w-24 shrink-0"
                        aria-label="Precio extra"
                      />
                      <button
                        type="button"
                        onClick={onSaveOption}
                        disabled={busy || !editOption.name.trim()}
                        className="btn btn-primary btn-icon h-8 w-8 shrink-0"
                        aria-label="Guardar opción"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditOption(null)}
                        className="btn btn-ghost btn-icon h-8 w-8 shrink-0"
                        aria-label="Cancelar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ) : (
                    <li
                      key={option.id}
                      className={`flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 ${
                        option.active ? '' : 'opacity-60'
                      }`}
                    >
                      <span className="min-w-0 flex-1 text-sm text-foreground">
                        {option.name}
                        {!option.active && <span className="ml-1 text-xs text-muted-foreground">(desactivada)</span>}
                      </span>
                      <span className="tabular shrink-0 text-sm font-medium text-muted-foreground">
                        {Number(option.priceDelta) === 0
                          ? 'Sin cargo'
                          : `${Number(option.priceDelta) > 0 ? '+' : ''}${formatMoney(option.priceDelta, countryCode)}`}
                      </span>
                      {option.active && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditOption({ id: option.id, name: option.name, priceDelta: String(Number(option.priceDelta)) })
                          }
                          disabled={busy}
                          className="btn btn-ghost btn-icon h-8 w-8 shrink-0"
                          aria-label={`Editar la opción ${option.name}`}
                          title="Editar opción"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {option.active ? (
                        <button
                          type="button"
                          onClick={() => void run(() => api.delete(`/menu/modifier-options/${option.id}`))}
                          disabled={busy}
                          className="btn btn-ghost btn-icon h-8 w-8 shrink-0"
                          aria-label={`Desactivar la opción ${option.name}`}
                          title="Desactivar opción"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void run(() => api.patch(`/menu/modifier-options/${option.id}`, { active: true }))}
                          disabled={busy}
                          className="btn btn-ghost btn-icon h-8 w-8 shrink-0"
                          aria-label={`Reactivar la opción ${option.name}`}
                          title="Reactivar opción"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ),
                )}
                {group.options.length === 0 && (
                  <li className="text-sm text-muted-foreground">Sin opciones — agregá al menos una.</li>
                )}
              </ul>

              <div className="flex flex-wrap gap-2">
                <input
                  value={optionDraft[group.id]?.name ?? ''}
                  onChange={(e) =>
                    setOptionDraft((d) => ({
                      ...d,
                      [group.id]: { name: e.target.value, priceDelta: d[group.id]?.priceDelta ?? '' },
                    }))
                  }
                  placeholder="Opción (ej: Queso extra)"
                  maxLength={80}
                  className="input min-w-0 flex-1"
                  aria-label={`Nombre de la nueva opción de ${group.name}`}
                />
                <input
                  type="number"
                  value={optionDraft[group.id]?.priceDelta ?? ''}
                  onChange={(e) =>
                    setOptionDraft((d) => ({
                      ...d,
                      [group.id]: { name: d[group.id]?.name ?? '', priceDelta: e.target.value },
                    }))
                  }
                  placeholder="0"
                  className="input tabular w-24"
                  aria-label={`Precio extra de la nueva opción de ${group.name}`}
                />
                <button
                  type="button"
                  onClick={() => onCreateOption(group.id)}
                  disabled={busy || !optionDraft[group.id]?.name?.trim()}
                  className="btn btn-sm"
                >
                  <Plus className="h-4 w-4" />
                  Agregar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
