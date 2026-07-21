'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, Plus, QrCode, Receipt, ShoppingBag, Trash2, UtensilsCrossed } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { formatMoney } from '@chillberry/domain';
import { cartaThemeStyle, resolveCartaTheme, type CartaTheme } from '@/lib/carta-theme';
import { Turnstile } from '@/components/turnstile';
import { Alert, Badge, EmptyState, Skeleton, type Tone } from '@/components/ui';

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
  imageUrl: string | null;
  modifierGroups: ModifierGroupView[];
  /** Un combo se vende como ítem normal a precio fijo; estos campos son sólo
   *  para mostrar qué trae. No cambian cómo se agrega al carrito. */
  isCombo: boolean;
  comboItems: { quantity: number; name: string }[];
};

/**
 * Una línea del carrito.
 *
 * Es un array y no un `Record<menuItemId, cantidad>` justamente por esto: dos
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

type MenuCategoryView = {
  id: string;
  name: string;
  items: MenuItemView[];
};

type PublicMenu = {
  restaurantName: string;
  restaurantLogoUrl: string | null;
  branchCoverImageUrl: string | null;
  branchName: string;
  tableCode: string;
  canOrder: boolean;
  currency: string;
  countryCode: string;
  /** Hex del color de marca del restaurante, o null si usa el de Chillberry. */
  brandColor: string | null;
  /** Diseño visual configurado por la sucursal (colores/letra/layout/portada),
   *  o null si la sucursal no personalizó nada. */
  cartaTheme: CartaTheme | null;
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

/**
 * Cuenta viva de la mesa: total acumulado + desglose de los pedidos abiertos.
 * Es SOLO LECTURA — el comensal la mira para saber cuánto lleva la mesa, no
 * dispara ninguna acción. `total` viene ya sumado del servidor como número.
 */
type TableAccount = {
  tableCode: string;
  currency: string;
  countryCode: string;
  total: number;
  orders: {
    id: string;
    status: string;
    total: string;
    createdAt: string;
    items: {
      quantity: number;
      name: string;
      unitPrice: string;
      notes: string | null;
      modifiers: OrderItemModifier[] | null;
    }[];
  }[];
};

const STATUS_LABEL: Record<string, string> = {
  WAITING: 'Recibido — todavía no empezó cocina',
  ACCEPTED: 'Aceptado por cocina',
  PREPARING: 'En preparación',
  READY: '¡Listo!',
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

const STATUS_POLL_MS = 5000;

export default function PublicMenuPage({ params }: { params: Promise<{ qrToken: string }> }) {
  const { qrToken } = use(params);
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  // Producto abierto en la hoja de personalización (el que tiene opciones).
  const [customizing, setCustomizing] = useState<MenuItemView | null>(null);
  const lineIdRef = useRef(0);

  const [placedOrder, setPlacedOrder] = useState<OrderStatusView | null>(null);
  // placedOrder es un objeto separado de menu (viene del POST /order y del
  // polling de /status, ninguno de los dos trae countryCode) — se captura acá
  // en el momento de confirmar el pedido para poder formatear el total en la
  // pantalla de confirmación sin depender de que `menu` siga en memoria.
  const [orderCountryCode, setOrderCountryCode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cuenta de la mesa (total vivo). Se busca on-demand al abrir el panel — no
  // hace falta pollear: el comensal la abre cuando quiere ver cuánto lleva.
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState<TableAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PublicMenu>(`/public/menu/${qrToken}`, { publicEndpoint: true })
      .then(setMenu)
      .catch((err) => setError((err as ApiError).message));
  }, [qrToken]);

  // Poll de estado mientras haya un pedido recién confirmado y no esté en
  // un estado terminal — evita seguir pegándole al servidor una vez que ya
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
   * `--carta-font` en el root de la carta. Como TODO el sistema consume esos
   * tokens (`bg-primary`, `text-primary`, `.btn-primary`, `shadow-glow`...), la
   * carta entera toma el color sin tocar una sola clase — ése es el pago del
   * sistema de tokens. El helper DERIVA el color del texto de la luminancia del
   * fondo, así que ninguna combinación queda ilegible.
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

  async function onConfirmOrder() {
    if (!menu) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ orderId: string; status: string; total: string }>(
        `/public/menu/${qrToken}/order`,
        {
          customerName: customerName || undefined,
          notes: orderNotes.trim() || undefined,
          // Se mandan los IDs de las opciones, nunca precios: el servidor
          // resuelve los deltas y recalcula el total.
          items: cartLines.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            notes: l.notes.trim() || undefined,
            modifierOptionIds: l.modifierOptionIds.length > 0 ? l.modifierOptionIds : undefined,
          })),
          turnstileToken,
        },
        { publicEndpoint: true },
      );
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
      setOrderCountryCode(menu.countryCode);
      setCart([]);
      setOrderNotes('');
      setCartOpen(false);
    } catch (err) {
      setSubmitError((err as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function openAccount() {
    setAccountOpen(true);
    setAccountLoading(true);
    setAccountError(null);
    try {
      const acc = await api.get<TableAccount>(`/public/menu/${qrToken}/account`, { publicEndpoint: true });
      setAccount(acc);
    } catch (err) {
      setAccountError((err as ApiError).message);
    } finally {
      setAccountLoading(false);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="panel w-full max-w-sm p-2">
          <EmptyState icon={QrCode} title="Código QR no válido" description={error} />
        </div>
      </main>
    );
  }

  if (!menu) {
    return (
      <main className="min-h-screen bg-background">
        <span className="sr-only">Cargando menú...</span>
        <Skeleton className="h-52 w-full rounded-none sm:h-64" />
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <Skeleton className="mx-auto mb-6 h-6 w-24 rounded-full" />
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

  // Vista de confirmación/seguimiento — reemplaza el menú una vez que el
  // pedido se envió, con el mismo criterio que /track/[deliveryId]: estado
  // en texto simple + polling, no hace falta socket para esto.
  if (placedOrder) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="panel w-full max-w-sm animate-scale-in p-6 shadow-glow">
          <div className="flex flex-col items-center text-center">
            {/* El pedido salió: es el único momento de celebración del flujo,
                y es lo último que el comensal ve del producto. */}
            <div className="brand-gradient mb-4 flex h-16 w-16 items-center justify-center rounded-full shadow-glow">
              <Check className="h-8 w-8 text-primary-foreground" strokeWidth={3} aria-hidden="true" />
            </div>
            <h1 className="font-heading text-2xl font-semibold text-foreground">¡Pedido enviado!</h1>
            <p className="mt-1 text-sm text-muted-foreground">Mesa {menu.tableCode}</p>
          </div>

          <div className="mt-5 flex justify-center">
            <Badge tone={STATUS_TONE[placedOrder.status] ?? 'neutral'} dot>
              {STATUS_LABEL[placedOrder.status] ?? placedOrder.status}
            </Badge>
          </div>

          <ul className="mt-5 space-y-3 border-t border-border pt-4">
            {placedOrder.items.map((it) => (
              <li key={it.id} className="flex items-baseline gap-2 text-base text-foreground">
                <span className="tabular font-semibold text-muted-foreground">{it.quantity}×</span>
                <span className="min-w-0 flex-1">
                  {it.name}
                  {/* El comensal tiene que poder confirmar que su "sin cebolla"
                      quedó registrado — si no, no tiene forma de saberlo. */}
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
              {formatMoney(placedOrder.total, orderCountryCode ?? '')}
            </span>
          </div>

          <button type="button" onClick={() => setPlacedOrder(null)} className="btn btn-lg mt-5 w-full">
            Volver al menú
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
        {/* Sin este overlay el texto blanco desaparece sobre una portada clara:
            la foto la sube el dueño y puede ser cualquier cosa. */}
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
        <div className="mb-6 flex flex-col items-center gap-3">
          <Badge tone="primary">Mesa {menu.tableCode}</Badge>
          {/* Cuenta viva de la mesa — visible siempre (incluso si la sucursal no
              toma pedidos por acá): sólo muestra el consumo, no pide nada. */}
          <button type="button" onClick={openAccount} className="btn btn-lg">
            <Receipt className="h-4 w-4" aria-hidden="true" />
            Ver mi cuenta
          </button>
        </div>

        {!menu.canOrder && (
          <Alert tone="warn" className="mb-6">
            Esta sucursal no está tomando pedidos por acá en este momento — avisale a tu mesero.
          </Alert>
        )}

        <div className="space-y-8">
          {menu.categories.map((category) => (
            <section key={category.id}>
              <h2 className="mb-3 font-heading text-xl font-semibold text-foreground">{category.name}</h2>
              <div className={isGridLayout ? 'grid grid-cols-2 gap-3 sm:grid-cols-3' : 'space-y-3'}>
                {category.items.map((item) => {
                  const qty = plainQtyOf(item.id);
                  const hasOptions = item.modifierGroups.length > 0;
                  return (
                    <div
                      key={item.id}
                      className={`card flex ${isGridLayout ? 'flex-col gap-2 p-3' : 'gap-3 p-3 sm:gap-4 sm:p-4'}`}
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
                        {/* El precio queda anclado abajo, a la altura del control
                            de cantidad: es el par que se compara al escanear. */}
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
                          <span className="tabular whitespace-nowrap font-heading text-lg font-semibold text-foreground">
                            {formatMoney(item.price, menu.countryCode)}
                          </span>
                          {/* Los productos con opciones no tienen +/− rápido: cada
                              combinación es una línea distinta, así que siempre
                              pasan por la hoja de personalización. */}
                          {menu.canOrder &&
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
                            ))}
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
              title="Este menú todavía no tiene productos cargados"
              description="En cuanto el restaurante los cargue, los vas a ver acá."
            />
          )}
        </div>

        {!menu.canOrder && (
          <p className="card mt-8 p-4 text-center text-base text-muted-foreground">
            Para hacer tu pedido, avisale a tu mesero.
          </p>
        )}
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

      {/* Cuenta de la mesa — panel de solo lectura con el total vivo acumulado
          y el desglose de cada pedido abierto. Reusa el mismo overlay/hoja que
          el carrito y la personalización. */}
      {accountOpen && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
          <div
            className="panel max-h-[90vh] w-full max-w-md animate-slide-up overflow-y-auto rounded-b-none p-5 sm:rounded-b-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Cuenta de la mesa"
          >
            <h2 className="font-heading text-xl font-semibold text-foreground">Cuenta de la mesa</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Mesa {menu.tableCode}</p>

            {accountLoading && (
              <div className="mt-5 space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}

            {accountError && (
              <Alert tone="error" className="mt-4">
                {accountError}
              </Alert>
            )}

            {account && !accountLoading && (
              <>
                {/* El total de la mesa es el número que el comensal viene a ver:
                    va grande y arriba de todo. */}
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3">
                  <span className="text-base text-muted-foreground">Total de la mesa</span>
                  <span className="tabular font-heading text-2xl font-semibold text-foreground">
                    {formatMoney(account.total, account.countryCode)}
                  </span>
                </div>

                {account.orders.length === 0 ? (
                  <p className="mt-5 text-base text-muted-foreground">Todavía no hay consumos en esta mesa.</p>
                ) : (
                  <div className="mt-5 space-y-4">
                    {account.orders.map((order) => (
                      <div key={order.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <Badge tone={STATUS_TONE[order.status] ?? 'neutral'} dot>
                            {STATUS_LABEL[order.status] ?? order.status}
                          </Badge>
                          <span className="tabular shrink-0 text-sm font-semibold text-foreground">
                            {formatMoney(order.total, account.countryCode)}
                          </span>
                        </div>
                        <ul className="space-y-2">
                          {order.items.map((it, i) => (
                            <li key={`${order.id}-${i}`} className="flex items-baseline gap-2 text-base text-foreground">
                              <span className="tabular font-semibold text-muted-foreground">{it.quantity}×</span>
                              <span className="min-w-0 flex-1">
                                {it.name}
                                {it.modifiers && it.modifiers.length > 0 && (
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    {it.modifiers.map((m, mi) => (
                                      <Badge key={`${order.id}-${i}-${mi}`} tone="info">
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
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <button type="button" onClick={() => setAccountOpen(false)} className="btn btn-lg mt-5 w-full">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Barra de carrito flotante — solo si se puede pedir y hay algo cargado. */}
      {menu.canOrder && cartCount > 0 && !cartOpen && !customizing && !accountOpen && (
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

      {/* Revisión del carrito. */}
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
                        aplica a este plato, no a toda la mesa. */}
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
              {cartLines.length === 0 && (
                <li className="text-base text-muted-foreground">Tu carrito quedó vacío.</li>
              )}
            </ul>

            <div className="mb-4 flex items-center justify-between border-t border-border pt-4">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="tabular font-heading text-xl font-semibold text-foreground">
                {formatMoney(cartTotal, menu.countryCode)}
              </span>
            </div>

            <div className="mb-4 space-y-1.5">
              <label className="label" htmlFor="customerName">
                Tu nombre <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <input
                id="customerName"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Así te reconoce el mesero"
                className="input w-full text-base"
              />
            </div>

            <div className="mb-4 space-y-1.5">
              <label className="label" htmlFor="orderNotes">
                Nota general <span className="font-normal text-muted-foreground">(opcional)</span>
              </label>
              <input
                id="orderNotes"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                maxLength={300}
                placeholder="Ej: somos alérgicos al maní"
                className="input w-full text-base"
              />
            </div>

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
                disabled={submitting || cartLines.length === 0 || !turnstileToken}
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
 * Hoja de personalización de un producto con opciones.
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
