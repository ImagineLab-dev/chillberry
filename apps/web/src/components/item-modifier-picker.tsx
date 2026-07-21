'use client';

import { formatMoney } from '@chillberry/domain';

/**
 * Selector de extras/modificadores compartido entre la carta por QR, la carga
 * a mano del mesero (`/waiter`) y la de admin (`/admin/orders`).
 *
 * Es un componente CONTROLADO: no guarda estado propio, el padre le pasa
 * `selected` y recibe cada cambio por `onChange`. Así el mismo picker sirve
 * para el carrito del mesero y para el quick-create de admin sin duplicar la
 * lógica de radio/checkbox/tope.
 *
 * Regla de selección (la misma que valida el servidor, replicada acá sólo para
 * bloquear "Agregar" antes de mandar):
 * - `maxSelect === 1` → radio: elegir otra opción del grupo reemplaza la previa.
 * - `maxSelect > 1`  → checkbox con tope: al llegar a `maxSelect` las demás
 *    opciones del grupo quedan deshabilitadas.
 *
 * Nunca se mandan precios, sólo los ids de las opciones: el backend resuelve
 * los `priceDelta` y recalcula el total.
 */

export type ModifierOptionView = { id: string; name: string; priceDelta: string };
export type ModifierGroupView = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ModifierOptionView[];
};

/**
 * ¿La selección cumple todos los grupos obligatorios (`required`) y los mínimos
 * (`minSelect`)? El servidor valida lo mismo — esto es para no dejar apretar
 * "Agregar" y enterarse recién en el error del POST.
 */
export function modifiersSatisfied(groups: ModifierGroupView[], selected: string[]): boolean {
  return groups.every((group) => {
    const count = group.options.filter((o) => selected.includes(o.id)).length;
    if (group.required && count === 0) return false;
    return count >= group.minSelect;
  });
}

export function ItemModifierPicker({
  groups,
  selected,
  onChange,
  countryCode,
}: {
  groups: ModifierGroupView[];
  selected: string[];
  onChange: (ids: string[]) => void;
  countryCode: string;
}) {
  function toggle(group: ModifierGroupView, optionId: string) {
    const groupOptionIds = group.options.map((o) => o.id);
    const inGroup = selected.filter((id) => groupOptionIds.includes(id));

    // Ya estaba elegida → destildar.
    if (inGroup.includes(optionId)) {
      onChange(selected.filter((id) => id !== optionId));
      return;
    }
    // Radio: reemplaza lo que hubiera en el grupo.
    if (group.maxSelect === 1) {
      onChange([...selected.filter((id) => !groupOptionIds.includes(id)), optionId]);
      return;
    }
    // Checkbox con tope: si el grupo ya llegó a maxSelect, no-op.
    if (inGroup.length >= group.maxSelect) return;
    onChange([...selected, optionId]);
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const count = group.options.filter((o) => selected.includes(o.id)).length;
        const mustPick = group.required || group.minSelect > 0;
        return (
          <fieldset key={group.id}>
            <legend className="mb-2 flex w-full items-center justify-between gap-2">
              <span className="font-heading text-sm font-semibold text-foreground">
                {group.name}
                {mustPick && (
                  <span className="text-error-foreground" aria-label="obligatorio">
                    {' '}
                    *
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {mustPick && <span className="mr-1 font-medium">obligatorio</span>}(hasta {group.maxSelect})
              </span>
            </legend>
            <div className="space-y-1.5">
              {group.options.map((option) => {
                const checked = selected.includes(option.id);
                const full = !checked && group.maxSelect > 1 && count >= group.maxSelect;
                const delta = Number(option.priceDelta);
                return (
                  <label
                    key={option.id}
                    className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
                      checked ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                    } ${full ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <input
                      type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                      name={group.id}
                      checked={checked}
                      disabled={full}
                      onChange={() => toggle(group, option.id)}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 text-sm text-foreground">{option.name}</span>
                    <span className="tabular shrink-0 text-xs font-medium text-muted-foreground">
                      {delta !== 0 ? `+${formatMoney(delta, countryCode)}` : 'Sin cargo'}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
