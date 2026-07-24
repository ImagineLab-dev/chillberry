'use client';

import { useEffect, useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  LayoutGrid,
  MapPin,
  MessageCircle,
  Music2,
  Phone,
  Plus,
  Share2,
  Star,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { Alert } from '@/components/ui';
import {
  CUSTOM_PRESETS,
  DEFAULT_HUB_BUTTONS,
  normalizeUrl,
  type HubButtonKind,
  type HubCustomIcon,
  type PublicHub,
  type PublicHubButton,
} from '@/lib/public-hub';

/** Datos de la sucursal que necesita el editor del hub. */
export type BranchHubFields = {
  id: string;
  publicSlug: string | null;
  publicHub: PublicHub | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

type IconCmp = React.ComponentType<{ className?: string }>;

const KIND_ICON: Record<HubButtonKind, IconCmp> = {
  menu: UtensilsCrossed,
  whatsapp: MessageCircle,
  call: Phone,
  map: MapPin,
  custom: Link2,
};

// Los de marca no existen en lucide 1.x: se usan íconos cercanos; la etiqueta
// del botón ("Instagram", "Facebook"...) es la que da el significado real.
const CUSTOM_ICON: Record<HubCustomIcon, IconCmp> = {
  link: Link2,
  instagram: Camera,
  facebook: Share2,
  tiktok: Music2,
  web: Globe,
  pdf: FileText,
  star: Star,
};

/** Pista de a dónde lleva cada builtin, para el editor. */
const KIND_HINT: Record<Exclude<HubButtonKind, 'custom'>, string> = {
  menu: 'Abre tu carta para ver y pedir.',
  whatsapp: 'Abre un chat de WhatsApp con el teléfono de la sucursal.',
  call: 'Llama al teléfono de la sucursal.',
  map: 'Abre el mapa con la ubicación de la sucursal.',
};

/** ¿El botón builtin tiene el dato necesario para aparecer en la página? */
function builtinResolvable(kind: HubButtonKind, b: BranchHubFields): boolean {
  switch (kind) {
    case 'menu':
      return true;
    case 'whatsapp':
    case 'call':
      return !!b.phone;
    case 'map':
      return (b.lat != null && b.lng != null) || !!b.address;
    default:
      return true;
  }
}

/** Motivo por el que un builtin no va a aparecer (o null si está OK). */
function missingDataReason(kind: HubButtonKind, b: BranchHubFields): string | null {
  if (builtinResolvable(kind, b)) return null;
  if (kind === 'whatsapp' || kind === 'call') return 'Cargá el teléfono de la sucursal para que este botón aparezca.';
  if (kind === 'map') return 'Fijá la ubicación de la sucursal para que este botón aparezca.';
  return null;
}

/**
 * Editor del "Linktree" de una sucursal: activa/desactiva la página de botones
 * del link público (`/r/:slug`), y deja reordenar, renombrar y encender/apagar
 * cada botón, más agregar links propios (Instagram, web, etc.). Reusa el diseño
 * visual de la carta — no se configura color/logo acá.
 */
export function BranchHubConfig({ branch, onSaved }: { branch: BranchHubFields; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(branch.publicHub?.enabled ?? false);
  const [headline, setHeadline] = useState(branch.publicHub?.headline ?? '');
  const [buttons, setButtons] = useState<PublicHubButton[]>(
    branch.publicHub?.buttons?.length ? branch.publicHub.buttons : DEFAULT_HUB_BUTTONS,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const publicUrl = branch.publicSlug && origin ? `${origin}/r/${branch.publicSlug}` : '';

  function patchButton(id: string, patch: Partial<PublicHubButton>) {
    setButtons((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function move(index: number, dir: -1 | 1) {
    setButtons((bs) => {
      const next = [...bs];
      const target = index + dir;
      if (target < 0 || target >= next.length) return bs;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function removeButton(id: string) {
    setButtons((bs) => bs.filter((b) => b.id !== id));
  }

  function addCustom(preset: { icon: HubCustomIcon; label: string }) {
    const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}`;
    setButtons((bs) => [...bs, { id, kind: 'custom', label: preset.label, enabled: true, url: '', icon: preset.icon }]);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // Normaliza: recorta etiquetas, y a los links propios les completa el https://
    const cleaned: PublicHubButton[] = buttons.map((b) =>
      b.kind === 'custom'
        ? { ...b, label: b.label.trim(), url: normalizeUrl(b.url ?? '') }
        : { ...b, label: b.label.trim() },
    );

    if (cleaned.some((b) => !b.label)) {
      setError('Todos los botones necesitan un nombre.');
      return;
    }
    const badCustom = cleaned.find((b) => b.kind === 'custom' && !b.url);
    if (badCustom) {
      setError(`Falta la URL del link "${badCustom.label}".`);
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/branches/${branch.id}`, {
        publicHub: {
          enabled,
          headline: headline.trim() || undefined,
          buttons: cleaned,
        },
      });
      setButtons(cleaned);
      setNotice('Página de botones guardada.');
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="font-heading text-base font-semibold">Página de botones (Linktree)</h3>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="ok">{notice}</Alert>}

      {/* Interruptor maestro */}
      <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg bg-muted/50 px-3">
        <span>
          <span className="label block">Mostrar la página de botones en tu link</span>
          <span className="text-xs text-muted-foreground">
            Con esto activado, tu link abre esta página. Apagado, abre la carta directo (como hoy).
          </span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
          aria-label="Mostrar la página de botones"
        />
      </label>

      {publicUrl ? (
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Ver mi página
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          Primero definí el enlace público arriba (en “Carta online de esta sucursal”) para poder verla.
        </p>
      )}

      {/* Frase corta */}
      <div className="space-y-1.5">
        <label htmlFor={`hub-headline-${branch.id}`} className="label">
          Frase corta <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <input
          id={`hub-headline-${branch.id}`}
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          maxLength={120}
          placeholder="Ej: Pedí online o reservá tu mesa"
          className="input w-full"
        />
      </div>

      {/* Botones */}
      <div className="space-y-2 border-t border-border pt-4">
        <span className="label block">Botones</span>
        <p className="text-xs text-muted-foreground">
          Usá las flechas para ordenar, la casilla para mostrar/ocultar, y el campo para renombrar.
        </p>

        <ul className="space-y-2">
          {buttons.map((b, i) => {
            const Icon = b.kind === 'custom' ? CUSTOM_ICON[b.icon ?? 'link'] : KIND_ICON[b.kind];
            const isCustom = b.kind === 'custom';
            const reason = !isCustom ? missingDataReason(b.kind, branch) : null;
            return (
              <li key={b.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-2">
                  {/* Reordenar */}
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="btn btn-icon h-6 w-6 disabled:opacity-30"
                      aria-label={`Subir ${b.label}`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === buttons.length - 1}
                      className="btn btn-icon h-6 w-6 disabled:opacity-30"
                      aria-label={`Bajar ${b.label}`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Mostrar/ocultar */}
                  <input
                    type="checkbox"
                    checked={b.enabled}
                    onChange={(e) => patchButton(b.id, { enabled: e.target.checked })}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary"
                    aria-label={`Mostrar ${b.label}`}
                  />

                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />

                  {/* Nombre */}
                  <input
                    value={b.label}
                    onChange={(e) => patchButton(b.id, { label: e.target.value })}
                    maxLength={40}
                    placeholder="Nombre del botón"
                    className="input h-10 min-w-0 flex-1 text-sm"
                    aria-label={`Nombre del botón ${b.label}`}
                  />

                  {/* Sólo los links propios se pueden borrar; los builtin se apagan. */}
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => removeButton(b.id)}
                      className="btn btn-icon h-10 w-10 shrink-0"
                      aria-label={`Quitar ${b.label}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Link propio: URL + ícono */}
                {isCustom && (
                  <div className="mt-2 flex gap-2 pl-8">
                    <select
                      value={b.icon ?? 'link'}
                      onChange={(e) => patchButton(b.id, { icon: e.target.value as HubCustomIcon })}
                      className="input h-10 w-28 shrink-0 text-sm"
                      aria-label={`Ícono de ${b.label}`}
                    >
                      {CUSTOM_PRESETS.map((p) => (
                        <option key={p.icon} value={p.icon}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={b.url ?? ''}
                      onChange={(e) => patchButton(b.id, { url: e.target.value })}
                      placeholder="instagram.com/tucuenta"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="input h-10 min-w-0 flex-1 text-sm"
                      aria-label={`URL de ${b.label}`}
                    />
                  </div>
                )}

                {/* Builtin: pista de destino o aviso de dato faltante. */}
                {!isCustom && (
                  <p className={`mt-1 pl-8 text-xs ${reason ? 'text-warn-foreground' : 'text-muted-foreground'}`}>
                    {reason ?? KIND_HINT[b.kind as Exclude<HubButtonKind, 'custom'>]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {/* Agregar link propio */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">Agregar link:</span>
          {CUSTOM_PRESETS.map((p) => (
            <button key={p.icon} type="button" onClick={() => addCustom(p)} className="btn btn-sm">
              <Plus className="h-3.5 w-3.5" />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <button disabled={saving} className="btn btn-primary min-h-[44px]">
        {saving ? 'Guardando...' : 'Guardar página de botones'}
      </button>
    </form>
  );
}
