'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Globe } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui';

/** Debe coincidir con la validación del backend (slug global único). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type BranchPublicFields = {
  id: string;
  publicSlug: string | null;
  publicOrderingEnabled: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  deliveryFee: string; // Decimal-as-string, ej. "0.00"
  // Ventana de delivery en minutos desde medianoche (null = sin restricción).
  deliveryStartMinute: number | null;
  deliveryEndMinute: number | null;
};

function validateSlug(value: string): string | null {
  if (value.length < 3 || value.length > 40) return 'El enlace debe tener entre 3 y 40 caracteres.';
  if (!SLUG_PATTERN.test(value))
    return 'Solo minúsculas, números y guiones; sin espacios ni guion al inicio o al final.';
  return null;
}

/** minutos desde medianoche → "HH:MM" para un <input type="time">. */
function minutesToTime(m: number | null): string {
  if (m == null) return '';
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** "HH:MM" → minutos desde medianoche, o null si está vacío/mal. */
function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Configuración de la carta pública / pedido online de una sucursal.
 * Estado propio inicializado una sola vez desde props: al recargar la lista del
 * padre no se pisan los cambios que el usuario tenga abiertos en el panel.
 */
export function BranchPublicConfig({
  branch,
  onSaved,
}: {
  branch: BranchPublicFields;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState(branch.publicSlug ?? '');
  const [orderingEnabled, setOrderingEnabled] = useState(branch.publicOrderingEnabled);
  const [delivery, setDelivery] = useState(branch.acceptsDelivery);
  const [pickup, setPickup] = useState(branch.acceptsPickup);
  const [fee, setFee] = useState(branch.deliveryFee ?? '0');
  // Ventana de delivery como HH:MM (vacío = sin corte de ese lado).
  const [deliveryStart, setDeliveryStart] = useState(minutesToTime(branch.deliveryStartMinute));
  const [deliveryEnd, setDeliveryEnd] = useState(minutesToTime(branch.deliveryEndMinute));

  // Slug efectivamente persistido — la URL para compartir sólo existe cuando
  // está guardado, no mientras se está tipeando.
  const [savedSlug, setSavedSlug] = useState(branch.publicSlug ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // window.location.origin recién en el cliente para evitar mismatch de hidratación.
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const shareUrl = savedSlug && origin ? `${origin}/r/${savedSlug}` : '';

  async function onCopy() {
    if (!shareUrl || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin permiso de clipboard: no rompemos, el usuario puede copiar a mano.
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSlugError(null);
    setNotice(null);

    const trimmedSlug = slug.trim();
    if (trimmedSlug) {
      const slugErr = validateSlug(trimmedSlug);
      if (slugErr) {
        setSlugError(slugErr);
        return;
      }
    }

    const feeNum = Number(fee);
    if (fee.trim() === '' || Number.isNaN(feeNum) || feeNum < 0) {
      setError('El costo de envío debe ser un número mayor o igual a 0.');
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/branches/${branch.id}`, {
        publicSlug: trimmedSlug || null,
        publicOrderingEnabled: orderingEnabled,
        acceptsDelivery: delivery,
        acceptsPickup: pickup,
        deliveryFee: feeNum,
        // Vacío → null (sin corte). Sólo tiene sentido si acepta delivery, pero
        // se manda igual: el backend lo ignora en el flujo de retiro.
        deliveryStartMinute: timeToMinutes(deliveryStart),
        deliveryEndMinute: timeToMinutes(deliveryEnd),
      });
      setSavedSlug(trimmedSlug);
      setNotice('Configuración guardada.');
      onSaved();
    } catch (err) {
      const apiErr = err as ApiError;
      // 409 = slug global ya en uso. Se muestra pegado al campo del enlace.
      if (apiErr.status === 409) setSlugError(apiErr.message);
      else setError(apiErr.message);
    } finally {
      setSaving(false);
    }
  }

  const slugId = `slug-${branch.id}`;
  const feeId = `fee-${branch.id}`;

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="font-heading text-base font-semibold">Carta pública / Pedido online</h3>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="ok">{notice}</Alert>}

      {/* Enlace público */}
      <div className="space-y-1.5">
        <label htmlFor={slugId} className="label">
          Enlace para compartir
        </label>
        <input
          id={slugId}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="mi-sucursal-centro"
          className="input w-full sm:max-w-sm"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Minúsculas, números y guiones (ej: <span className="tabular">centro-palermo</span>). Entre 3 y 40 caracteres.
        </p>
        {slugError && <p className="text-xs text-error-foreground">{slugError}</p>}

        {shareUrl && (
          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2.5">
            <span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{shareUrl}</span>
            <button
              type="button"
              onClick={onCopy}
              className="btn btn-sm min-h-[44px] shrink-0"
              aria-label="Copiar enlace"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? '¡Copiado!' : 'Copiar'}
            </button>
          </div>
        )}
      </div>

      {/* Toggles */}
      <div className="space-y-2 border-t border-border pt-4">
        <label className="flex min-h-[44px] items-center justify-between gap-3">
          <span className="label">Recibir pedidos online</span>
          <input
            type="checkbox"
            checked={orderingEnabled}
            onChange={(e) => setOrderingEnabled(e.target.checked)}
            className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
            aria-label="Recibir pedidos online"
          />
        </label>
        <label className="flex min-h-[44px] items-center justify-between gap-3">
          <span className="label">Acepta envío a domicilio</span>
          <input
            type="checkbox"
            checked={delivery}
            onChange={(e) => setDelivery(e.target.checked)}
            className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
            aria-label="Acepta envío a domicilio"
          />
        </label>
        <label className="flex min-h-[44px] items-center justify-between gap-3">
          <span className="label">Acepta retiro en el local</span>
          <input
            type="checkbox"
            checked={pickup}
            onChange={(e) => setPickup(e.target.checked)}
            className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
            aria-label="Acepta retiro en el local"
          />
        </label>
      </div>

      {/* Costo de envío */}
      <div className="space-y-1.5 border-t border-border pt-4">
        <label htmlFor={feeId} className="label">
          Costo de envío
        </label>
        <input
          id={feeId}
          type="number"
          min={0}
          step="0.01"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          className="input tabular w-full sm:w-40"
          aria-label="Costo de envío"
        />
        <p className="text-xs text-muted-foreground">
          Se cobra cuando el cliente elige envío a domicilio. Poné 0 si el envío es gratis.
        </p>
      </div>

      {/* Horario de delivery — corte propio, además del horario general de la
          sucursal. Sólo relevante si acepta envíos. */}
      {delivery && (
        <div className="space-y-2 border-t border-border pt-4">
          <span className="label">Horario para tomar envíos</span>
          <p className="text-xs text-muted-foreground">
            Corte específico del delivery, aparte del horario general del local (ej: abre hasta las 23:00
            pero deja de tomar envíos a las 22:00). Dejá vacío para no limitar.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor={`del-start-${branch.id}`} className="text-xs text-muted-foreground">
                Desde
              </label>
              <input
                id={`del-start-${branch.id}`}
                type="time"
                value={deliveryStart}
                onChange={(e) => setDeliveryStart(e.target.value)}
                className="input tabular w-32"
                aria-label="Delivery desde"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`del-end-${branch.id}`} className="text-xs text-muted-foreground">
                Hasta
              </label>
              <input
                id={`del-end-${branch.id}`}
                type="time"
                value={deliveryEnd}
                onChange={(e) => setDeliveryEnd(e.target.value)}
                className="input tabular w-32"
                aria-label="Delivery hasta"
              />
            </div>
            {(deliveryStart || deliveryEnd) && (
              <button
                type="button"
                onClick={() => {
                  setDeliveryStart('');
                  setDeliveryEnd('');
                }}
                className="btn btn-ghost btn-sm min-h-[44px]"
              >
                Limpiar
              </button>
            )}
          </div>
          {deliveryEnd && deliveryStart && timeToMinutes(deliveryEnd)! <= timeToMinutes(deliveryStart)! && (
            <p className="text-xs text-muted-foreground">
              La hora de fin es anterior a la de inicio — se toma como que el delivery cruza la medianoche.
            </p>
          )}
        </div>
      )}

      <button disabled={saving} className="btn btn-primary min-h-[44px]">
        {saving ? 'Guardando...' : 'Guardar carta pública'}
      </button>
    </form>
  );
}
