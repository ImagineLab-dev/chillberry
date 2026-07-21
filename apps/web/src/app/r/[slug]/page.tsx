'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bike, Check, Clock, MapPin, Minus, Phone, Plus, ShoppingBag, Store, Trash2, UtensilsCrossed } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { formatMoney } from '@chillberry/domain';
import { cartaThemeStyle, resolveCartaTheme, type CartaTheme } from '@/lib/carta-theme';
import { Turnstile } from '@/components/turnstile';
import { Alert, Badge, EmptyState, Skeleton, type Tone } from '@/components/ui';
import { guardarPedidoEnCurso, leerPedidoEnCurso, olvidarPedidoEnCurso } from '@/lib/pedido-en-curso';

type ModifierOptionView = { id: string; name: string; priceDelta: string };
type ModifierGroupView = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ModifierOptionView[];
};

type MenuItemView = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  /** Precio para delivery, o null = igual al base. */
  deliveryPrice: string | null;
  /** "86": agotado por hoy — no se puede pedir. */
  soldOut: boolean;
  imageUrl: string | null;
  modifierGroups: ModifierGroupView[];
  /** Un combo se vende como ítem normal a precio fijo; estos campos son sólo
   *  para mostrar qué trae. No cambian cómo se agrega al carrito. */
  isCombo: boolean;
  comboItems: { quantity: number; name: string }[];
};

type MenuCategoryView = {
  id: string;
  name: string;
  items: MenuItemView[];
};

/**
 * Una línea del carrito — misma lógica que la carta por QR (`/menu/[qrToken]`).
 *
 * Es un array y no un `Record<menuItemId, cantidad>` a propósito: dos
 * hamburguesas —una "sin cebolla" y otra normal— son dos líneas distintas del
 * mismo producto. Con un map por menuItemId colisionarían en la misma clave y
 * una de las dos notas se perdería.
 *
 * `lineId` es local del cliente (nunca se manda al servidor): solo sirve de
 * key estable de React y para editar/borrar la línea correcta.
 */
type CartLine = {
  lineId: number;
  menuItemId: string;
  quantity: number;
  notes: string;
  modifierOptionIds: string[];
};

type Fulfillment = 'DELIVERY' | 'PICKUP';

type BranchHours = { weekday: number; openMinute: number; closeMinute: number };

type BranchMenu = {
  restaurantName: string;
  restaurantLogoUrl: string | null;
  branchCoverImageUrl: string | null;
  branchName: string;
  branchAddress: string;
  branchPhone: string | null;
  currency: string;
  countryCode: string;
  /** Hex del color de marca del restaurante, o null si usa el de Chillberry. */
  brandColor: string | null;
  /** Diseño visual configurado por la sucursal (colores/letra/layout/portada),
   *  o null si la sucursal no personalizó nada. */
  cartaTheme: CartaTheme | null;
  canOrder: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  /** Decimal-as-string, ej. "15000". */
  deliveryFee: string;
  /** Ventana de delivery (minutos desde medianoche) + si está abierto AHORA
   *  para envíos (abierto general Y dentro de la ventana). */
  deliveryStartMinute: number | null;
  deliveryEndMinute: number | null;
  deliveryOpenNow: boolean;
  isOpenNow: boolean;
  closedReason: 'closed_date' | 'closed_today' | 'outside_hours' | null;
  hours: BranchHours[];
  categories: MenuCategoryView[];
};

type OrderItemModifier = { groupName: string; optionName: string; priceDelta: string };
type OrderStatusView = {
  id: string;
  status: string;
  total: string;
  createdAt: string;
  notes?: string | null;
  items: {
    id: string;
    quantity: number;
    name: string;
    unitPrice: string;
    notes?: string | null;
    modifiers?: OrderItemModifier[] | null;
  }[];
};

const STATUS_LABEL: Record<string, string> = {
  WAITING: 'Recibido — todavía no empezó cocina',
  ACCEPTED: 'Aceptado por cocina',
  PREPARING: 'En preparación',
  READY: '¡Listo para retirar!',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
};

const STATUS_TONE: Record<string, Tone> = {
  WAITING: 'warn',
  ACCEPTED: 'info',
  PREPARING: 'info',
  READY: 'ok',
  COMPLETED: 'ok',
  CANCELLED: 'error',
};

const CLOSED_LABEL: Record<NonNullable<BranchMenu['closedReason']>, string> = {
  closed_date: 'Hoy el local está cerrado',
  closed_today: 'Hoy no abre',
  outside_hours: 'Cerrado en este momento',
};

/** minutos desde medianoche → "HH:MM". */
function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Texto de la ventana de delivery para mostrarle al cliente, o null. */
function deliveryWindowText(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  if (start != null && end != null) return `Envíos de ${minutesToHHMM(start)} a ${minutesToHHMM(end)}`;
  if (end != null) return `Envíos hasta las ${minutesToHHMM(end)}`;
  return `Envíos desde las ${minutesToHHMM(start!)}`;
}

// weekday 0=Dom .. 6=Sáb (convención de Date.getDay, la misma del backend).
const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const STATUS_POLL_MS = 5000;

/** Minutos desde medianoche → "HH:MM". */
function formatMinute(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export default function BranchOrderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();

  const [menu, setMenu] = useState<BranchMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Pedido con envío que este navegador dejó a medias, para poder volver a seguirlo. */
  const [pedidoEnCurso, setPedidoEnCurso] = useState<{ token: string; estado: string } | null>(null);

  // ¿Este navegador dejó un pedido a medias? Se pregunta el estado real antes
  // de mostrar nada: si ya se entregó o se canceló, se olvida en silencio en vez
  // de ofrecer un seguimiento que no lleva a ningún lado.
  useEffect(() => {
    const guardado = leerPedidoEnCurso(slug);
    if (!guardado) return;

    let cancelado = false;
    api
      .get<{ status: string }>(`/track/${guardado.token}`, { publicEndpoint: true })
      .then((t) => {
        if (cancelado) return;
        const terminado = t.status === 'DELIVERED' || t.status.includes('CANCELLED') || t.status === 'FAILED';
        if (terminado) olvidarPedidoEnCurso(slug);
        else setPedidoEnCurso({ token: guardado.token, estado: t.status });
      })
      .catch(() => {
        // El delivery ya no existe (purgado, id inválido): se descarta.
        olvidarPedidoEnCurso(slug);
      });
    return () => {
      cancelado = true;
    };
  }, [slug]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  // Búsqueda de la carta (filtra productos por nombre/descripción).
  const [menuSearch, setMenuSearch] = useState('');
  // Cupón de descuento que tipea el cliente (lo valida el server al confirmar).
  const [couponCode, setCouponCode] = useState('');
  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  // Producto abierto en la hoja de personalización (el que tiene opciones).
  const [customizing, setCustomizing] = useState<MenuItemView | null>(null);
  const lineIdRef = useRef(0);

  // Solo se usa en el flujo de RETIRO: delivery redirige a /track. Es un objeto
  // separado de `menu` (viene del POST y del polling de /status), con el mismo
  // criterio que la carta por QR.
  const [placedOrder, setPlacedOrder] = useState<OrderStatusView | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api
      .get<BranchMenu>(`/public/menu/branch/${slug}`, { publicEndpoint: true })
      .then(setMenu)
      .catch((err) => setError((err as ApiError).message));
  }, [slug]);

  // Preselección del tipo de entrega según lo que acepte la sucursal Y esté
  // disponible AHORA. Si el delivery está cerrado por horario pero hay retiro,
  // arranca (o se corrige) en Retiro. Si sólo hay delivery y está cerrado,
  // queda en Delivery y el confirm se bloquea con un aviso claro.
  useEffect(() => {
    if (!menu) return;
    const canDeliverNow = menu.acceptsDelivery && menu.deliveryOpenNow;
    setFulfillment((prev) => {
      if (prev === 'DELIVERY' && !canDeliverNow && menu.acceptsPickup) return 'PICKUP';
      if (prev) return prev;
      if (canDeliverNow) return 'DELIVERY';
      if (menu.acceptsPickup) return 'PICKUP';
      return menu.acceptsDelivery ? 'DELIVERY' : null;
    });
  }, [menu]);

  // Poll de estado mientras haya un pedido de retiro recién confirmado y no esté
  // en un estado terminal — evita seguir pegándole al servidor una vez que ya
  // no va a cambiar más.
  useEffect(() => {
    if (!placedOrder) return;
    if (['COMPLETED', 'CANCELLED'].includes(placedOrder.status)) return;

    pollRef.current = setInterval(() => {
      api
        .get<OrderStatusView>(`/public/menu/orders/${placedOrder.id}/status`, { publicEndpoint: true })
        .then(setPlacedOrder)
        .catch(() => {});
    }, STATUS_POLL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedOrder?.id, placedOrder?.status]);

  const allItems = useMemo(() => menu?.categories.flatMap((c) => c.items) ?? [], [menu]);
  const itemById = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);

  /**
   * Tema visual de la carta: pisa `--primary`/`--primary-foreground` (del color
   * de la sucursal o, si no hay, del brandColor del tenant), `--carta-accent` y
   * `--carta-font` en el root. Como TODO el sistema consume esos tokens
   * (`bg-primary`, `text-primary`, `.btn-primary`, `shadow-glow`...), la página
   * entera toma el color sin tocar una sola clase. El helper DERIVA el color del
   * texto de la luminancia del fondo, así que ninguna combinación queda ilegible.
   *
   * Con `cartaTheme` en null, el helper cae al brandColor del tenant y a la letra
   * por defecto → se reproduce el look de hoy. Se agrega `--ring` alineado al
   * primario para conservar el color del anillo de foco que había antes.
   */
  const rootStyle = useMemo(() => {
    const style = cartaThemeStyle(menu?.cartaTheme, menu?.brandColor ?? null) as Record<string, string>;
    if (style['--primary']) style['--ring'] = style['--primary'];
    return style as React.CSSProperties;
  }, [menu?.cartaTheme, menu?.brandColor]);

  /** Precio unitario con los extras sumados. El servidor recalcula esto igual
   *  desde los ids — acá es solo para mostrar. */
  const lineUnitPrice = useCallback(
    (line: CartLine) => {
      const item = itemById.get(line.menuItemId);
      if (!item) return 0;
      const delta = item.modifierGroups
        .flatMap((g) => g.options)
        .filter((o) => line.modifierOptionIds.includes(o.id))
        .reduce((sum, o) => sum + Number(o.priceDelta), 0);
      return Number(item.price) + delta;
    },
    [itemById],
  );

  /** Mismo shape que el snapshot que guarda el servidor — para poder mostrar
   *  la confirmación sin esperar el primer poll de estado. */
  const modifierSnapshotOf = useCallback(
    (line: CartLine): OrderItemModifier[] | null => {
      const item = itemById.get(line.menuItemId);
      if (!item || line.modifierOptionIds.length === 0) return null;
      return item.modifierGroups.flatMap((g) =>
        g.options
          .filter((o) => line.modifierOptionIds.includes(o.id))
          .map((o) => ({ groupName: g.name, optionName: o.name, priceDelta: o.priceDelta })),
      );
    },
    [itemById],
  );

  const cartLines = useMemo(() => cart.filter((l) => itemById.has(l.menuItemId)), [cart, itemById]);
  const cartCount = cartLines.reduce((sum, l) => sum + l.quantity, 0);
  const cartTotal = cartLines.reduce((sum, l) => sum + lineUnitPrice(l) * l.quantity, 0);

  // Horarios agrupados por día — se muestran cuando el local está cerrado, que
  // es el momento en que el cliente se pregunta "¿y cuándo abre?".
  const hoursByDay = useMemo(() => {
    const map = new Map<number, { openMinute: number; closeMinute: number }[]>();
    for (const h of menu?.hours ?? []) {
      const arr = map.get(h.weekday) ?? [];
      arr.push({ openMinute: h.openMinute, closeMinute: h.closeMinute });
      map.set(h.weekday, arr);
    }
    return map;
  }, [menu?.hours]);

  /** Cantidad de la línea "simple" (sin extras ni nota) de un producto — es la
   *  que manejan los +/− de la tarjeta. */
  function plainQtyOf(itemId: string) {
    return cart.find((l) => l.menuItemId === itemId && l.modifierOptionIds.length === 0 && !l.notes)?.quantity ?? 0;
  }

  function addPlain(itemId: string) {
    setCart((c) => {
      const i = c.findIndex((l) => l.menuItemId === itemId && l.modifierOptionIds.length === 0 && !l.notes);
      if (i === -1) {
        return [...c, { lineId: ++lineIdRef.current, menuItemId: itemId, quantity: 1, notes: '', modifierOptionIds: [] }];
      }
      return c.map((l, idx) => (idx === i ? { ...l, quantity: l.quantity + 1 } : l));
    });
  }

  function decrementPlain(itemId: string) {
    setCart((c) => {
      const i = c.findIndex((l) => l.menuItemId === itemId && l.modifierOptionIds.length === 0 && !l.notes);
      if (i === -1) return c;
      const line = c[i]!;
      if (line.quantity <= 1) return c.filter((_, idx) => idx !== i);
      return c.map((l, idx) => (idx === i ? { ...l, quantity: l.quantity - 1 } : l));
    });
  }

  function changeLineQty(lineId: number, delta: number) {
    setCart((c) =>
      c.flatMap((l) => {
        if (l.lineId !== lineId) return [l];
        const next = l.quantity + delta;
        return next <= 0 ? [] : [{ ...l, quantity: next }];
      }),
    );
  }

  function setLineNotes(lineId: number, notes: string) {
    setCart((c) => c.map((l) => (l.lineId === lineId ? { ...l, notes } : l)));
  }

  function addCustomLine(itemId: string, modifierOptionIds: string[], notes: string) {
    setCart((c) => [
      ...c,
      { lineId: ++lineIdRef.current, menuItemId: itemId, quantity: 1, notes: notes.trim(), modifierOptionIds },
    ]);
  }

  // ---- Estado derivado del pedido -----------------------------------------
  const orderingEnabled = !!menu && menu.canOrder && (menu.acceptsDelivery || menu.acceptsPickup);
  const isOpen = !!menu && menu.isOpenNow;
  // ¿Se puede elegir DELIVERY ahora? Abierto en general + dentro de la ventana
  // de envíos de la sucursal.
  const deliveryAvailable = !!menu && menu.acceptsDelivery && menu.deliveryOpenNow;
  const deliveryWindowLabel = menu ? deliveryWindowText(menu.deliveryStartMinute, menu.deliveryEndMinute) : null;
  const deliveryFeeNum = menu ? Number(menu.deliveryFee) : 0;
  const feeApplies = fulfillment === 'DELIVERY';
  const displayedTotal = cartTotal + (feeApplies ? deliveryFeeNum : 0);

  const nameOk = customerName.trim().length >= 2;
  const phoneOk = customerPhone.trim().length >= 6;
  const addressOk = fulfillment !== 'DELIVERY' || address.trim().length >= 5;
  // No dejar confirmar un delivery fuera de la ventana de envíos (el server lo
  // rechaza igual, pero así el botón queda deshabilitado con aviso).
  const deliveryTimeOk = fulfillment !== 'DELIVERY' || deliveryAvailable;
  const canConfirm =
    orderingEnabled &&
    isOpen &&
    !!fulfillment &&
    cartLines.length > 0 &&
    !!turnstileToken &&
    nameOk &&
    phoneOk &&
    addressOk &&
    deliveryTimeOk &&
    !submitting;

  async function onConfirmOrder() {
    if (!menu || !fulfillment) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{
        orderId: string;
        deliveryId?: string;
        trackingToken?: string;
        fulfillment: Fulfillment;
        status: string;
        total: string;
      }>(
        `/public/menu/branch/${slug}/order`,
        {
          fulfillment,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          address: fulfillment === 'DELIVERY' ? address.trim() : undefined,
          notes: orderNotes.trim() || undefined,
          // Se mandan los IDs de las opciones, nunca precios: el servidor
          // resuelve los deltas y recalcula el total (el nuestro es preview).
          items: cartLines.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            notes: l.notes.trim() || undefined,
            modifierOptionIds: l.modifierOptionIds.length > 0 ? l.modifierOptionIds : undefined,
          })),
          couponCode: couponCode.trim() || undefined,
          turnstileToken,
        },
        { publicEndpoint: true },
      );

      // Delivery: el seguimiento vive en /track (mapa + repartidor por socket).
      if (res.fulfillment === 'DELIVERY' && res.trackingToken) {
        // Se recuerda ANTES de redirigir: el token del seguimiento es
        // aleatorio y si el cliente cierra la pestaña no tiene forma de volver.
        // El link de la carta sí lo tiene a mano, así que desde acá lo recupera.
        guardarPedidoEnCurso(slug, res.trackingToken);
        router.push(`/track/${res.trackingToken}`);
        return;
      }

      // Retiro: confirmación in-page con polling de estado, igual que la carta QR.
      setPlacedOrder({
        id: res.orderId,
        status: res.status,
        total: res.total,
        createdAt: new Date().toISOString(),
        notes: orderNotes.trim() || null,
        items: cartLines.map((l) => ({
          id: String(l.lineId),
          quantity: l.quantity,
          name: itemById.get(l.menuItemId)!.name,
          unitPrice: String(lineUnitPrice(l)),
          notes: l.notes.trim() || null,
          modifiers: modifierSnapshotOf(l),
        })),
      });
      setCart([]);
      setOrderNotes('');
      setCartOpen(false);
    } catch (err) {
      setSubmitError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Slug inexistente → la API responde 404. Estado amable, mismo criterio que
  // la carta por QR ante un token inválido.
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="panel w-full max-w-sm p-2">
          <EmptyState
            icon={Store}
            title="Carta no encontrada"
            description="No encontramos esta carta. Revisá el enlace o pedíselo de nuevo al local."
          />
        </div>
      </main>
    );
  }

  if (!menu) {
    return (
      <main className="min-h-screen bg-background">
        <span className="sr-only">Cargando carta...</span>
        <Skeleton className="h-52 w-full rounded-none sm:h-64" />
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <Skeleton className="mb-4 h-16 w-full" />
          <Skeleton className="mb-3 h-6 w-40" />
          <div className="space-y-3">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        </div>
      </main>
    );
  }

  // Confirmación de RETIRO — reemplaza la carta una vez enviado el pedido.
  if (placedOrder) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4" style={rootStyle}>
        <div className="panel w-full max-w-sm animate-scale-in p-6 shadow-glow">
          <div className="flex flex-col items-center text-center">
            <div className="brand-gradient mb-4 flex h-16 w-16 items-center justify-center rounded-full shadow-glow">
              <Check className="h-8 w-8 text-primary-foreground" strokeWidth={3} aria-hidden="true" />
            </div>
            <h1 className="font-heading text-2xl font-semibold text-foreground">¡Pedido confirmado!</h1>
            <p className="mt-1 text-sm text-muted-foreground">Retiro en {menu.branchName}</p>
          </div>

          <div className="mt-5 flex justify-center">
            <Badge tone={STATUS_TONE[placedOrder.status] ?? 'neutral'} dot>
              {STATUS_LABEL[placedOrder.status] ?? placedOrder.status}
            </Badge>
          </div>

          <p className="mt-4 rounded-md bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
            Te avisamos por acá cuando esté listo para retirar. Se paga al retirar.
          </p>

          <ul className="mt-5 space-y-3 border-t border-border pt-4">
            {placedOrder.items.map((it) => (
              <li key={it.id} className="flex items-baseline gap-2 text-base text-foreground">
                <span className="tabular font-semibold text-muted-foreground">{it.quantity}×</span>
                <span className="min-w-0 flex-1">
                  {it.name}
                  {it.modifiers && it.modifiers.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {it.modifiers.map((m, i) => (
                        <Badge key={`${it.id}-${i}`} tone="info">
                          {m.optionName}
                        </Badge>
                      ))}
                    </span>
                  )}
                  {it.notes && <span className="mt-0.5 block text-sm text-warn-foreground">{it.notes}</span>}
                </span>
              </li>
            ))}
          </ul>

          {placedOrder.notes && (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{placedOrder.notes}</p>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="tabular font-heading text-xl font-semibold text-foreground">
              {formatMoney(placedOrder.total, menu.countryCode)}
            </span>
          </div>

          {/* Dónde retirar — el dato que el cliente necesita ahora. */}
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{menu.branchAddress}</span>
            </p>
            {menu.branchPhone && (
              <a
                href={`tel:${menu.branchPhone}`}
                className="flex items-center gap-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                {menu.branchPhone}
              </a>
            )}
          </div>

          <button type="button" onClick={() => setPlacedOrder(null)} className="btn btn-lg mt-5 w-full">
            Volver a la carta
          </button>
        </div>
      </main>
    );
  }

  // Tema resuelto (con defaults): manda el layout, qué se muestra y la portada.
  const resolved = resolveCartaTheme(menu.cartaTheme);
  const headerLogoUrl = resolved.logoUrl ?? menu.restaurantLogoUrl;
  const headerUsesCover = resolved.headerStyle === 'imagen' && !!menu.branchCoverImageUrl;
  const isGridLayout = resolved.layout === 'grilla';

  // Carta filtrada por la búsqueda: quita las categorías que quedan sin ítems.
  const searchQuery = menuSearch.trim().toLowerCase();
  const visibleCategories = searchQuery
    ? menu.categories
        .map((c) => ({
          ...c,
          items: c.items.filter(
            (i) =>
              i.name.toLowerCase().includes(searchQuery) ||
              (i.description ?? '').toLowerCase().includes(searchQuery),
          ),
        }))
        .filter((c) => c.items.length > 0)
    : menu.categories;

  return (
    <main
      className="min-h-screen bg-background pb-28"
      style={{ ...rootStyle, fontFamily: 'var(--carta-font)' }}
    >
      {/* Fuentes de la carta (Playfair/Oswald/Nunito) — Next las eleva al <head>.
          Los stacks tienen fallback web-safe, así que es una mejora progresiva. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font -- carta pública sin _document (App Router); carga puntual aceptable */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Oswald:wght@400;600&family=Nunito:wght@400;600;700&display=swap"
      />
      {/* Volver al seguimiento. Es la razón de ser de esto: el token no se
          puede adivinar, y si el cliente cerró esa pestaña el link de la carta
          es lo único que le queda. Va arriba de todo y pegado, para que lo
          encuentre sin buscar. */}
      {pedidoEnCurso && (
        <a
          href={`/track/${pedidoEnCurso.token}`}
          className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-primary px-4 py-3 text-primary-foreground"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Bike className="h-4 w-4 shrink-0" aria-hidden="true" />
            Tenés un pedido en camino
          </span>
          <span className="shrink-0 text-sm underline underline-offset-2">Ver seguimiento</span>
        </a>
      )}

      {/* Portada de la sucursal según headerStyle: 'imagen' usa la foto de
          portada (con overlay para que el texto se lea); 'solido' un color plano
          de marca; 'gradiente' (default) el degradé de marca de siempre. */}
      <div
        className={`relative h-52 w-full sm:h-64 ${resolved.headerStyle === 'solido' ? 'bg-primary' : 'brand-gradient'}`}
        style={
          headerUsesCover
            ? { backgroundImage: `url(${menu.branchCoverImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      >
        {/* Sin este overlay el texto blanco desaparece sobre una portada clara. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/25" />
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-4 pb-5">
          {headerLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={headerLogoUrl}
              alt={`Logo de ${menu.restaurantName}`}
              className="mb-3 h-16 w-16 rounded-xl border-2 border-white/90 object-cover shadow-lg"
            />
          )}
          <h1 className="text-center font-heading text-3xl font-semibold text-white drop-shadow-md">
            {menu.restaurantName}
          </h1>
          <p className="mt-0.5 text-sm text-white/90 drop-shadow">{menu.branchName}</p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-5">
        {/* Datos del local + estado abierto/cerrado. */}
        <div className="card-dense mb-4 space-y-2 p-4">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{menu.branchAddress}</span>
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {menu.branchPhone && (
              <a
                href={`tel:${menu.branchPhone}`}
                className="flex items-center gap-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                {menu.branchPhone}
              </a>
            )}
            {orderingEnabled &&
              (isOpen ? (
                <Badge tone="ok" dot>
                  Abierto ahora
                </Badge>
              ) : (
                <Badge tone="error" dot>
                  Cerrado
                </Badge>
              ))}
          </div>
        </div>

        {/* Ordering deshabilitado del todo (canOrder=false o ningún tipo de
            entrega aceptado): carta navegable, sin pedido. */}
        {!orderingEnabled && (
          <Alert tone="warn" className="mb-6">
            Este local no está tomando pedidos online en este momento. Podés mirar la carta igual.
          </Alert>
        )}

        {/* Abierto para pedir pero cerrado en este momento: banner + horarios. */}
        {orderingEnabled && !isOpen && (
          <div className="mb-6 space-y-3">
            <Alert tone="warn">{menu.closedReason ? CLOSED_LABEL[menu.closedReason] : 'Cerrado en este momento'}</Alert>
            {menu.hours.length > 0 && (
              <div className="card-dense p-4">
                <p className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-foreground">
                  <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Horarios
                </p>
                <ul className="space-y-1">
                  {DAY_LABELS.map((label, day) => {
                    const ranges = hoursByDay.get(day);
                    return (
                      <li key={day} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="tabular text-foreground">
                          {ranges && ranges.length > 0
                            ? ranges
                                .map((r) => `${formatMinute(r.openMinute)}–${formatMinute(r.closeMinute)}`)
                                .join(' · ')
                            : 'Cerrado'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Búsqueda de la carta — útil en menús largos. Filtra por nombre y
            descripción; las categorías sin resultados se ocultan. */}
        {menu.categories.some((c) => c.items.length > 0) && (
          <input
            type="search"
            value={menuSearch}
            onChange={(e) => setMenuSearch(e.target.value)}
            placeholder="Buscar en la carta..."
            aria-label="Buscar en la carta"
            className="input mb-6 w-full"
          />
        )}

        {searchQuery && visibleCategories.length === 0 && (
          <p className="text-base text-muted-foreground">Nada coincide con “{menuSearch}”.</p>
        )}

        <div className="space-y-8">
          {visibleCategories.map((category) => (
            <section key={category.id}>
              <h2 className="mb-3 font-heading text-xl font-semibold text-foreground">{category.name}</h2>
              <div className={isGridLayout ? 'grid grid-cols-2 gap-3 sm:grid-cols-3' : 'space-y-3'}>
                {category.items.map((item) => {
                  const qty = plainQtyOf(item.id);
                  const hasOptions = item.modifierGroups.length > 0;
                  // Precio por canal: en delivery, si hay `deliveryPrice`, ese manda.
                  const displayPrice =
                    fulfillment === 'DELIVERY' && item.deliveryPrice ? item.deliveryPrice : item.price;
                  return (
                    <div
                      key={item.id}
                      className={`card flex ${isGridLayout ? 'flex-col gap-2 p-3' : 'gap-3 p-3 sm:gap-4 sm:p-4'} ${
                        item.soldOut ? 'opacity-60' : ''
                      }`}
                    >
                      {resolved.showImages &&
                        (item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className={
                              isGridLayout
                                ? 'h-32 w-full shrink-0 rounded-lg object-cover'
                                : 'h-28 w-28 shrink-0 rounded-lg object-cover sm:h-32 sm:w-32'
                            }
                          />
                        ) : (
                          <div
                            className={`flex shrink-0 items-center justify-center rounded-lg bg-muted ${
                              isGridLayout ? 'h-32 w-full' : 'h-28 w-28 sm:h-32 sm:w-32'
                            }`}
                          >
                            <UtensilsCrossed className="h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
                          </div>
                        ))}
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-base font-semibold text-foreground">{item.name}</h3>
                          {item.isCombo && <Badge tone="primary">Combo</Badge>}
                        </div>
                        {resolved.showDescriptions && item.description && (
                          <p className="mt-1 text-base leading-snug text-muted-foreground">{item.description}</p>
                        )}
                        {item.isCombo && item.comboItems.length > 0 && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            Incluye: {item.comboItems.map((c) => `${c.quantity}× ${c.name}`).join(' · ')}
                          </p>
                        )}
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
                          <span className="tabular whitespace-nowrap font-heading text-lg font-semibold text-foreground">
                            {formatMoney(displayPrice, menu.countryCode)}
                          </span>
                          {/* Los productos con opciones no tienen +/− rápido: cada
                              combinación es una línea distinta, así que siempre
                              pasan por la hoja de personalización. */}
                          {item.soldOut ? (
                            <Badge tone="warn">Agotado</Badge>
                          ) : (
                            orderingEnabled &&
                            (hasOptions ? (
                              <button
                                type="button"
                                onClick={() => setCustomizing(item)}
                                className="btn btn-primary h-11 px-4"
                                aria-label={`Elegir opciones de ${item.name}`}
                              >
                                <Plus className="h-4 w-4" />
                                Elegir
                              </button>
                            ) : qty > 0 ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => decrementPlain(item.id)}
                                  className="btn btn-icon h-11 w-11"
                                  aria-label={`Quitar uno de ${item.name}`}
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <span className="tabular w-7 text-center font-heading text-base font-semibold text-foreground">
                                  {qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => addPlain(item.id)}
                                  className="btn btn-primary btn-icon h-11 w-11"
                                  aria-label={`Agregar otro ${item.name}`}
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addPlain(item.id)}
                                className="btn btn-primary h-11 px-4"
                                aria-label={`Agregar ${item.name} al pedido`}
                              >
                                <Plus className="h-4 w-4" />
                                Agregar
                              </button>
                            )))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {category.items.length === 0 && (
                  <p className="text-base text-muted-foreground">Todavía no hay nada en esta categoría.</p>
                )}
              </div>
            </section>
          ))}
          {menu.categories.length === 0 && (
            <EmptyState
              icon={UtensilsCrossed}
              title="Esta carta todavía no tiene productos cargados"
              description="En cuanto el restaurante los cargue, los vas a ver acá."
            />
          )}
        </div>
      </div>

      {customizing && (
        <CustomizeSheet
          item={customizing}
          countryCode={menu.countryCode}
          onCancel={() => setCustomizing(null)}
          onConfirm={(optionIds, notes) => {
            addCustomLine(customizing.id, optionIds, notes);
            setCustomizing(null);
          }}
        />
      )}

      {/* Barra de carrito flotante — solo si se puede pedir y hay algo cargado. */}
      {orderingEnabled && cartCount > 0 && !cartOpen && !customizing && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-4">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="btn btn-primary btn-lg mx-auto flex w-full max-w-2xl animate-slide-up items-center justify-between shadow-glow"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5" aria-hidden="true" />
              {cartCount} {cartCount === 1 ? 'producto' : 'productos'}
            </span>
            <span className="tabular font-semibold">Ver pedido · {formatMoney(cartTotal, menu.countryCode)}</span>
          </button>
        </div>
      )}

      {/* Revisión del carrito + tipo de entrega + datos de contacto. */}
      {cartOpen && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div className="panel max-h-[90vh] w-full max-w-md animate-slide-up overflow-y-auto rounded-b-none p-5 sm:rounded-b-xl">
            <h2 className="mb-4 font-heading text-xl font-semibold text-foreground">Tu pedido</h2>

            <ul className="mb-4 space-y-4">
              {cartLines.map((line) => {
                const item = itemById.get(line.menuItemId)!;
                const mods = modifierSnapshotOf(line);
                return (
                  <li key={line.lineId} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-base text-foreground">{item.name}</span>
                      <button
                        type="button"
                        onClick={() => changeLineQty(line.lineId, -1)}
                        className="btn btn-icon h-11 w-11"
                        aria-label={`Quitar uno de ${item.name}`}
                      >
                        {line.quantity === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      </button>
                      <span className="tabular w-6 text-center text-base font-semibold text-foreground">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeLineQty(line.lineId, 1)}
                        className="btn btn-icon h-11 w-11"
                        aria-label={`Agregar uno de ${item.name}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <span className="tabular w-16 shrink-0 text-right text-base font-medium text-foreground">
                        {formatMoney(lineUnitPrice(line) * line.quantity, menu.countryCode)}
                      </span>
                    </div>

                    {mods && mods.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {mods.map((m, i) => (
                          <Badge key={`${line.lineId}-${i}`} tone="info">
                            {m.optionName}
                            {Number(m.priceDelta) !== 0 && ` ${Number(m.priceDelta) > 0 ? '+' : ''}${formatMoney(m.priceDelta, menu.countryCode)}`}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* La nota va acá y no en el pedido entero: "sin cebolla"
                        aplica a este plato. */}
                    <input
                      value={line.notes}
                      onChange={(e) => setLineNotes(line.lineId, e.target.value)}
                      maxLength={300}
                      placeholder="Nota para cocina (ej: sin cebolla)"
                      className="input mt-2 w-full text-base"
                      aria-label={`Nota para cocina de ${item.name}`}
                    />
                  </li>
                );
              })}
              {cartLines.length === 0 && <li className="text-base text-muted-foreground">Tu carrito quedó vacío.</li>}
            </ul>

            {/* Tipo de entrega. Toggle solo si la sucursal acepta las dos
                modalidades; si acepta una sola, queda fija y solo se rotula. */}
            {menu.acceptsDelivery && menu.acceptsPickup ? (
              <div className="mb-4">
                <span className="label mb-1.5 block">¿Cómo lo querés?</span>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de entrega">
                  <button
                    type="button"
                    onClick={() => setFulfillment('DELIVERY')}
                    disabled={!deliveryAvailable}
                    aria-pressed={fulfillment === 'DELIVERY'}
                    title={!deliveryAvailable ? 'Delivery cerrado en este momento' : undefined}
                    className={`btn h-12 ${fulfillment === 'DELIVERY' ? 'btn-primary' : ''}`}
                  >
                    <Bike className="h-4 w-4" />
                    Delivery
                  </button>
                  <button
                    type="button"
                    onClick={() => setFulfillment('PICKUP')}
                    aria-pressed={fulfillment === 'PICKUP'}
                    className={`btn h-12 ${fulfillment === 'PICKUP' ? 'btn-primary' : ''}`}
                  >
                    <Store className="h-4 w-4" />
                    Retiro
                  </button>
                </div>
                {/* Aviso cuando el local está abierto pero el delivery ya cortó
                    por horario — el cliente entiende por qué sólo puede retirar. */}
                {menu.isOpenNow && !deliveryAvailable && (
                  <p className="mt-1.5 text-xs text-warn-foreground">
                    Delivery cerrado ahora{deliveryWindowLabel ? ` — ${deliveryWindowLabel.toLowerCase()}` : ''}. Podés
                    pedir para retirar.
                  </p>
                )}
              </div>
            ) : (
              <div className="mb-4 space-y-1.5">
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
                  {fulfillment === 'DELIVERY' ? (
                    <>
                      <Bike className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      Envío a domicilio
                    </>
                  ) : (
                    <>
                      <Store className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      Retiro en el local
                    </>
                  )}
                </div>
                {/* Sólo delivery y cerrado por horario: aviso explícito (no hay
                    retiro como alternativa). */}
                {fulfillment === 'DELIVERY' && menu.isOpenNow && !deliveryAvailable && (
                  <p className="text-xs text-warn-foreground">
                    Delivery cerrado en este momento{deliveryWindowLabel ? ` — ${deliveryWindowLabel.toLowerCase()}` : ''}.
                  </p>
                )}
              </div>
            )}

            <div className="mb-4 space-y-1.5">
              <label className="label" htmlFor="customerName">
                Tu nombre
              </label>
              <input
                id="customerName"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={120}
                placeholder="Nombre y apellido"
                className="input w-full text-base"
                autoComplete="name"
              />
            </div>

            <div className="mb-4 space-y-1.5">
              <label className="label" htmlFor="customerPhone">
                Teléfono
              </label>
              <input
                id="customerPhone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                maxLength={30}
                placeholder="Por si necesitan contactarte"
                className="input w-full text-base"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>

            {/* La dirección solo aparece —y solo es obligatoria— en Delivery. */}
            {fulfillment === 'DELIVERY' && (
              <div className="mb-4 space-y-1.5">
                <label className="label" htmlFor="address">
                  Dirección de entrega
                </label>
                <input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  maxLength={240}
                  placeholder="Calle, número, piso/depto, referencia"
                  className="input w-full text-base"
                  autoComplete="street-address"
                />
              </div>
            )}

            <div className="mb-4 space-y-1.5">
              <label className="label" htmlFor="orderNotes">
                Nota general <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <input
                id="orderNotes"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                maxLength={300}
                placeholder="Ej: tocar timbre, somos alérgicos al maní"
                className="input w-full text-base"
              />
            </div>

            {/* Resumen. El total real lo calcula el servidor — este es preview. */}
            <div className="mb-4 space-y-1.5 border-t border-border pt-4">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular text-foreground">{formatMoney(cartTotal, menu.countryCode)}</span>
              </div>
              {feeApplies && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Envío</span>
                  <span className="tabular text-foreground">
                    {deliveryFeeNum > 0 ? formatMoney(deliveryFeeNum, menu.countryCode) : 'Gratis'}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="tabular font-heading text-xl font-semibold text-foreground">
                  {formatMoney(displayedTotal, menu.countryCode)}
                </span>
              </div>
            </div>

            {/* Cupón: el descuento lo calcula y valida el servidor al confirmar
                (si no sirve, el pedido se rechaza con el motivo). */}
            <div className="mb-4 space-y-1.5">
              <label className="label" htmlFor="couponCode">
                ¿Tenés un cupón?
              </label>
              <input
                id="couponCode"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                placeholder="Código de descuento (opcional)"
                maxLength={32}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="input tabular w-full uppercase text-base"
              />
            </div>

            <p className="mb-4 rounded-md bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
              Se paga al {fulfillment === 'DELIVERY' ? 'recibir el pedido' : 'retirar'}.
            </p>

            {orderingEnabled && !isOpen && (
              <Alert tone="warn" className="mb-3">
                {menu.closedReason ? CLOSED_LABEL[menu.closedReason] : 'Cerrado en este momento'}. No podés confirmar el
                pedido hasta que el local abra.
              </Alert>
            )}

            {submitError && (
              <Alert tone="error" className="mb-3">
                {submitError}
              </Alert>
            )}

            <div className="mb-4 flex justify-center">
              <Turnstile onVerify={setTurnstileToken} />
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => setCartOpen(false)} className="btn btn-lg flex-1">
                Seguir viendo
              </button>
              <button
                type="button"
                onClick={onConfirmOrder}
                disabled={!canConfirm}
                className="btn btn-primary btn-lg flex-1"
              >
                {submitting ? 'Enviando...' : 'Confirmar pedido'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * Hoja de personalización de un producto con opciones — idéntica a la de la
 * carta por QR (`/menu/[qrToken]`).
 *
 * `maxSelect === 1` se comporta como radio (elegir otra reemplaza), > 1 como
 * checkbox con tope. El botón de confirmar queda bloqueado hasta cumplir los
 * `required`/`minSelect` — el servidor valida lo mismo igual, pero enterarse
 * recién al confirmar el pedido sería una mala experiencia.
 */
function CustomizeSheet({
  item,
  countryCode,
  onCancel,
  onConfirm,
}: {
  item: MenuItemView;
  countryCode: string;
  onCancel: () => void;
  onConfirm: (optionIds: string[], notes: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  function toggle(group: ModifierGroupView, optionId: string) {
    setSelected((prev) => {
      const groupOptionIds = group.options.map((o) => o.id);
      const inGroup = prev.filter((id) => groupOptionIds.includes(id));

      if (inGroup.includes(optionId)) return prev.filter((id) => id !== optionId);
      if (group.maxSelect === 1) {
        return [...prev.filter((id) => !groupOptionIds.includes(id)), optionId];
      }
      if (inGroup.length >= group.maxSelect) return prev;
      return [...prev, optionId];
    });
  }

  const unmet = item.modifierGroups.filter((g) => {
    const count = g.options.filter((o) => selected.includes(o.id)).length;
    return (g.required && count === 0) || count < g.minSelect;
  });

  const delta = item.modifierGroups
    .flatMap((g) => g.options)
    .filter((o) => selected.includes(o.id))
    .reduce((sum, o) => sum + Number(o.priceDelta), 0);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div
        className="panel max-h-[90vh] w-full max-w-md animate-slide-up overflow-y-auto rounded-b-none p-5 sm:rounded-b-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Opciones de ${item.name}`}
      >
        <h2 className="font-heading text-xl font-semibold text-foreground">{item.name}</h2>
        <p className="tabular mt-0.5 text-sm text-muted-foreground">{formatMoney(item.price, countryCode)}</p>

        <div className="mt-5 space-y-5">
          {item.modifierGroups.map((group) => {
            const count = group.options.filter((o) => selected.includes(o.id)).length;
            return (
              <fieldset key={group.id}>
                <legend className="mb-2 flex w-full items-center justify-between gap-2">
                  <span className="font-heading text-base font-semibold text-foreground">{group.name}</span>
                  {group.required ? (
                    <Badge tone="warn">Obligatorio</Badge>
                  ) : group.maxSelect > 1 ? (
                    <span className="text-xs text-muted-foreground">
                      Hasta {group.maxSelect} ({count} elegida{count === 1 ? '' : 's'})
                    </span>
                  ) : null}
                </legend>
                <div className="space-y-1.5">
                  {group.options.map((option) => {
                    const checked = selected.includes(option.id);
                    const full = !checked && group.maxSelect > 1 && count >= group.maxSelect;
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
                        <span className="min-w-0 flex-1 text-base text-foreground">{option.name}</span>
                        {Number(option.priceDelta) !== 0 && (
                          <span className="tabular shrink-0 text-sm font-medium text-muted-foreground">
                            {Number(option.priceDelta) > 0 ? '+' : ''}
                            {formatMoney(option.priceDelta, countryCode)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <div className="space-y-1.5">
            <label className="label" htmlFor={`notes-${item.id}`}>
              Nota para cocina <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <input
              id={`notes-${item.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={300}
              placeholder="Ej: sin cebolla, bien cocido"
              className="input w-full text-base"
            />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">Subtotal</span>
          <span className="tabular font-heading text-lg font-semibold text-foreground">
            {formatMoney(Number(item.price) + delta, countryCode)}
          </span>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="btn btn-lg flex-1">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected, notes)}
            disabled={unmet.length > 0}
            className="btn btn-primary btn-lg flex-1"
          >
            {unmet.length > 0 ? `Elegí ${unmet[0]!.name}` : 'Agregar al pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}
