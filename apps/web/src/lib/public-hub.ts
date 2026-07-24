/**
 * "Linktree" de una sucursal — espeja `PublicHubDto` del API. La página de
 * botones que ve el cliente en el link público (`/r/:slug`) cuando está activa.
 * Opt-in: sin config o con `enabled: false`, el link muestra la carta directo.
 */

export type HubButtonKind = 'menu' | 'whatsapp' | 'call' | 'map' | 'custom';
export type HubCustomIcon = 'link' | 'instagram' | 'facebook' | 'tiktok' | 'web' | 'star' | 'pdf';

export type PublicHubButton = {
  /** Id estable (key de React + reordenar). */
  id: string;
  kind: HubButtonKind;
  label: string;
  enabled: boolean;
  /** Sólo `custom`. */
  url?: string;
  /** Ícono de los links propios. */
  icon?: HubCustomIcon;
};

export type PublicHub = {
  enabled?: boolean;
  headline?: string;
  buttons?: PublicHubButton[];
};

/** Los builtin (destino derivado de la sucursal) — no se borran, sólo se apagan. */
export const BUILTIN_KINDS: readonly HubButtonKind[] = ['menu', 'whatsapp', 'call', 'map'];

/** Set inicial cuando el dueño activa el hub por primera vez. `call` apagado por
 *  defecto (muchos ya tienen WhatsApp); el resto encendido. */
export const DEFAULT_HUB_BUTTONS: PublicHubButton[] = [
  { id: 'menu', kind: 'menu', label: 'Ver carta y pedir', enabled: true },
  { id: 'whatsapp', kind: 'whatsapp', label: 'WhatsApp', enabled: true },
  { id: 'call', kind: 'call', label: 'Llamar', enabled: false },
  { id: 'map', kind: 'map', label: 'Cómo llegar', enabled: true },
];

/** Etiqueta por defecto de cada builtin (para el editor). */
export const BUILTIN_LABELS: Record<Exclude<HubButtonKind, 'custom'>, string> = {
  menu: 'Ver carta y pedir',
  whatsapp: 'WhatsApp',
  call: 'Llamar',
  map: 'Cómo llegar',
};

/** Presets de link propio para el "Agregar link" (etiqueta + ícono sugeridos). */
export const CUSTOM_PRESETS: { icon: HubCustomIcon; label: string }[] = [
  { icon: 'instagram', label: 'Instagram' },
  { icon: 'facebook', label: 'Facebook' },
  { icon: 'tiktok', label: 'TikTok' },
  { icon: 'web', label: 'Sitio web' },
  { icon: 'pdf', label: 'Menú PDF' },
  { icon: 'link', label: 'Otro link' },
];

export type ResolvedHubButton = {
  id: string;
  kind: HubButtonKind;
  label: string;
  /** Destino. `null` en `menu` (lo maneja el cambio de vista, no navega). */
  href: string | null;
  icon: HubCustomIcon | HubButtonKind;
  /** Abre en pestaña nueva (links propios). */
  external: boolean;
};

/** Teléfono → dígitos para `wa.me` (sin `+`, espacios ni guiones). */
function phoneDigits(phone: string): string {
  return phone.replace(/[^\d]/g, '').replace(/^00/, '');
}

/** URL sin protocolo → https:// (lo que el dueño pega en el editor). */
export function normalizeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

/**
 * Resuelve los botones a renderizar: filtra los apagados y los builtin que no
 * tienen dato (ej. WhatsApp sin teléfono cargado → se omite, nunca un botón
 * muerto). Respeta el orden del array.
 */
export function resolveHubButtons(
  hub: PublicHub | null | undefined,
  ctx: { phone: string | null; lat: number | null; lng: number | null; address: string | null },
): ResolvedHubButton[] {
  const buttons = hub?.buttons?.length ? hub.buttons : DEFAULT_HUB_BUTTONS;
  const out: ResolvedHubButton[] = [];
  for (const b of buttons) {
    if (!b.enabled) continue;
    const href = resolveHref(b, ctx);
    if (href === undefined) continue; // builtin sin dato → se omite
    out.push({
      id: b.id,
      kind: b.kind,
      label: b.label,
      href,
      icon: b.kind === 'custom' ? b.icon ?? 'link' : b.kind,
      external: b.kind === 'custom',
    });
  }
  return out;
}

/** `null` = destino manejado en la propia página (menu); `undefined` = omitir. */
function resolveHref(
  b: PublicHubButton,
  ctx: { phone: string | null; lat: number | null; lng: number | null; address: string | null },
): string | null | undefined {
  switch (b.kind) {
    case 'menu':
      return null;
    case 'whatsapp':
      return ctx.phone ? `https://wa.me/${phoneDigits(ctx.phone)}` : undefined;
    case 'call':
      return ctx.phone ? `tel:${ctx.phone}` : undefined;
    case 'map':
      if (ctx.lat != null && ctx.lng != null) {
        return `https://www.google.com/maps/search/?api=1&query=${ctx.lat},${ctx.lng}`;
      }
      return ctx.address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ctx.address)}`
        : undefined;
    case 'custom':
      return b.url ? b.url : undefined;
  }
}
