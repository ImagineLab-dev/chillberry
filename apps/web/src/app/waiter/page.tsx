'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Check, LogOut, Minus, Plus, Receipt, Users, X } from 'lucide-react';
import { BILL_SPLIT_MODE, formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { ItemModifierPicker, modifiersSatisfied, type ModifierGroupView } from '@/components/item-modifier-picker';
import { logout } from '@/lib/auth';
import { connectKitchenSocket } from '@/lib/socket';
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  TABLE_STATUS_LABEL,
  TABLE_STATUS_TONE,
} from '@/lib/status-labels';
import { Alert, Badge, type Tone } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/components/toast';

type Branch = { id: string; name: string };
type ActiveOrder = { id: string; status: string; total: string; billRequestedAt: string | null; createdAt: string };
type TableRow = { id: string; code: string; status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED'; capacity: number | null; orders: ActiveOrder[] };
type MenuItemRow = {
  id: string;
  name: string;
  price: string;
  modifierGroups: ModifierGroupView[];
  /** Un combo se vende como ítem normal; estos campos son sólo para mostrar
   *  qué trae. No cambian cómo se agrega al pedido. */
  isCombo: boolean;
  comboComponents: { quantity: number; component: { id: string; name: string } }[];
};
type OrderDetail = {
  id: string;
  status: string;
  total: string;
  billRequestedAt: string | null;
  table: { id: string; code: string } | null;
  items: { id: string; quantity: number; unitPrice: string; round: number; menuItem: { name: string } }[];
};

type CartLine = { menuItemId: string; quantity: number; notes?: string; modifierOptionIds: string[] };

/** Convierte una línea del carrito al shape que espera el backend. Manda los
 *  ids de extras sólo si hay alguno; nunca precios (el server los resuelve). */
function toOrderItem(line: CartLine) {
  return {
    menuItemId: line.menuItemId,
    quantity: line.quantity,
    notes: line.notes,
    modifierOptionIds: line.modifierOptionIds.length > 0 ? line.modifierOptionIds : undefined,
  };
}

/**
 * Qué badge le mostramos al mozo por mesa.
 *
 * Antes el COLOR salía del estado de la MESA y el TEXTO del estado del PEDIDO,
 * así que una mesa con la comida lista se veía roja y decía "READY": dos señales
 * contradictorias, y encima el texto en inglés crudo del enum. Ahora texto y
 * color salen siempre de la misma fuente, con esta prioridad:
 *
 *  1. Pidió la cuenta — es lo único que exige que el mozo vaya YA. Gana sobre
 *     todo lo demás (el dato ya venía del backend y no se estaba usando).
 *  2. Estado del pedido activo, si hay uno.
 *  3. Estado de la mesa, si no hay pedido.
 */
function tableBadge(table: TableRow, active: ActiveOrder | undefined): { label: string; tone: Tone } {
  if (active?.billRequestedAt) return { label: 'Pidió la cuenta', tone: 'warn' };
  if (active) {
    return {
      label: ORDER_STATUS_LABEL[active.status] ?? active.status,
      tone: ORDER_STATUS_TONE[active.status] ?? 'neutral',
    };
  }
  return {
    label: TABLE_STATUS_LABEL[table.status] ?? table.status,
    tone: TABLE_STATUS_TONE[table.status] ?? 'neutral',
  };
}

export default function WaiterPage() {
  const router = useRouter();
  const { notify } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tables, setTables] = useState<TableRow[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Id del ítem que se está editando/quitando (para deshabilitar sus botones).
  const [itemBusy, setItemBusy] = useState<string | null>(null);
  /** Hay una acción del mozo en vuelo: bloquea el resto para que un toque doble
   *  no mande dos veces lo mismo (dos pedidos, dos rondas, dos uniones). */
  const [busy, setBusy] = useState(false);

  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickItem, setPickItem] = useState('');
  const [pickQty, setPickQty] = useState('1');
  const [pickNotes, setPickNotes] = useState('');
  const [pickMods, setPickMods] = useState<string[]>([]);
  const [countryCode, setCountryCode] = useState('PY');

  const [splitParts, setSplitParts] = useState<{ label: string; amount: string }[]>([
    { label: 'Persona 1', amount: '' },
    { label: 'Persona 2', amount: '' },
  ]);
  const [splitNotice, setSplitNotice] = useState<string | null>(null);
  const [readyNotice, setReadyNotice] = useState<string | null>(null);

  async function loadBranches() {
    const b = await api.get<Branch[]>('/branches');
    setBranches(b);
    if (!branchId && b[0]) setBranchId(b[0].id);
  }

  async function loadTables(forBranchId: string) {
    if (!forBranchId) return;
    const [t, m] = await Promise.all([
      api.get<TableRow[]>('/waiter/tables', { query: { branchId: forBranchId } }),
      api.get<MenuItemRow[]>('/menu/items', { query: { branchId: forBranchId } }),
    ]);
    setTables(t);
    setMenuItems(m);
  }

  useEffect(() => {
    loadBranches().catch(() => {});
    api
      .get<{ countryCode: string }>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Sin esto, una API caída deja el mapa de mesas EN BLANCO: ni error, ni
    // spinner, ni empty state. El mozo no puede distinguir "no hay mesas
    // cargadas" de "no anda el wifi".
    loadTables(branchId).catch(() => setError('No pudimos cargar los datos. Revisá la conexión y reintentá.'));
  }, [branchId]);

  // Aviso EN VIVO de "pedido listo": el mozo escucha el mismo canal por sucursal
  // que el KDS (namespace `/kitchen`). Cuando cocina termina un pedido, suena un
  // beep, aparece el banner y se recargan las mesas para reflejar el estado.
  useEffect(() => {
    if (!branchId) return;
    const socket = connectKitchenSocket();
    socket.on('connect', () => socket.emit('kitchen:join', { branchId }));
    socket.on('order:ready', (payload: { tableCode: string | null; type: string }) => {
      const message = payload.tableCode
        ? `Mesa ${payload.tableCode}: pedido listo para servir`
        : payload.type === 'DELIVERY'
          ? 'Un pedido de delivery está listo para despachar'
          : 'Un pedido está listo para retirar';
      // Toast con sonido (pop-up efímero para captar la atención) + banner
      // persistente abajo (queda hasta que el mozo lo atiende / llega el próximo).
      notify({ title: '¡Pedido listo!', description: message, tone: 'ok', sound: 'ready' });
      setReadyNotice(message);
      loadTables(branchId).catch(() => {});
    });
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    const activeOrderId = tables.find((t) => t.id === selectedTableId)?.orders[0]?.id;
    if (activeOrderId) {
      api
        .get<OrderDetail>(`/orders/${activeOrderId}`)
        .then(setOrderDetail)
        .catch(() => setOrderDetail(null));
    } else {
      setOrderDetail(null);
    }
  }, [selectedTableId, tables]);

  function selectTable(table: TableRow) {
    setError(null);
    setSplitNotice(null);
    if (mergeMode) {
      setMergeSelection((prev) =>
        prev.includes(table.id) ? prev.filter((id) => id !== table.id) : [...prev, table.id],
      );
      return;
    }
    setSelectedTableId(table.id);
    setCart([]);
  }

  /**
   * Corre una acción bloqueando las demás mientras está en vuelo.
   *
   * Sin esto, un toque doble en una tablet lenta mandaba DOS pedidos a la misma
   * mesa: dos comandas a cocina y el total duplicado. El backend no tiene red de
   * contención acá — `POST /orders` no acepta clave de idempotencia (sólo la
   * tiene el cobro), así que la única defensa es no dejar disparar dos veces.
   */
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function onOpenTable(tableId: string) {
    await run(async () => {
      await api.post(`/waiter/tables/${tableId}/open`);
      await loadTables(branchId);
    });
  }

  function addToCart() {
    if (!pickItem) return;
    setCart((c) => [
      ...c,
      {
        menuItemId: pickItem,
        quantity: Number(pickQty) || 1,
        notes: pickNotes.trim() || undefined,
        modifierOptionIds: pickMods,
      },
    ]);
    setPickQty('1');
    setPickNotes('');
    setPickMods([]);
  }

  async function onCreateOrder() {
    if (!selectedTableId || cart.length === 0) return;
    await run(async () => {
      await api.post('/orders', { branchId, tableId: selectedTableId, items: cart.map(toOrderItem) });
      setCart([]);
      await loadTables(branchId);
    });
  }

  // Segunda ronda a una mesa que ya tiene pedido ("agregame un postre"). Reusa
  // el mismo carrito que arma un pedido nuevo; el backend suma a cocina solo
  // los ítems nuevos y acumula el total.
  async function onAddRound() {
    if (!orderDetail || cart.length === 0) return;
    await run(async () => {
      const updated = await api.post<OrderDetail>(`/orders/${orderDetail.id}/items`, { items: cart.map(toOrderItem) });
      setOrderDetail(updated);
      setCart([]);
      await loadTables(branchId);
    });
  }

  // Quitar un ítem mal disparado sin cancelar todo el pedido. El backend
  // recalcula el total y avisa a cocina.
  async function onRemoveItem(itemId: string) {
    if (!orderDetail) return;
    setError(null);
    setItemBusy(itemId);
    try {
      const updated = await api.delete<OrderDetail>(`/orders/${orderDetail.id}/items/${itemId}`);
      setOrderDetail(updated);
      await loadTables(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setItemBusy(null);
    }
  }

  // Cambiar la cantidad de un ítem ya enviado ("eran 2 no 3"). qty<1 no se
  // manda: para llegar a 0 se usa el botón de quitar.
  async function onChangeItemQty(itemId: string, quantity: number) {
    if (!orderDetail || quantity < 1) return;
    setError(null);
    setItemBusy(itemId);
    try {
      const updated = await api.patch<OrderDetail>(`/orders/${orderDetail.id}/items/${itemId}`, { quantity });
      setOrderDetail(updated);
      await loadTables(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setItemBusy(null);
    }
  }

  async function onTransfer(toTableId: string) {
    if (!orderDetail) return;
    setError(null);
    try {
      await api.post('/waiter/tables/transfer', { orderId: orderDetail.id, toTableId });
      setSelectedTableId(toTableId);
      await loadTables(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function onMerge() {
    // Fusionar mueve la cuenta de varias mesas a una y no tiene "desunir" en la
    // UI: se confirma antes de tocar nada.
    const cuantas = mergeSelection.length;
    if (!window.confirm(`Vas a unir ${cuantas} mesas en una sola cuenta. Esto no se puede deshacer. ¿Seguimos?`)) {
      return;
    }
    await run(async () => {
      await api.post('/waiter/tables/merge', { tableIds: mergeSelection });
      setMergeMode(false);
      setMergeSelection([]);
      await loadTables(branchId);
    });
  }

  async function onRequestBill() {
    if (!orderDetail) return;
    await run(async () => {
      const updated = await api.post<{ billRequestedAt: string }>(`/waiter/orders/${orderDetail.id}/request-bill`);
      setOrderDetail({ ...orderDetail, billRequestedAt: updated.billRequestedAt });
    });
  }

  async function onSplit() {
    if (!orderDetail) return;
    setSplitNotice(null);
    await run(async () => {
      await api.post(`/waiter/orders/${orderDetail.id}/split`, {
        mode: BILL_SPLIT_MODE.ByPerson,
        parts: splitParts.map((p) => ({ label: p.label, amount: Number(p.amount) })),
      });
      setSplitNotice('Cuenta dividida correctamente');
    });
  }

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  const selectedTable = tables.find((t) => t.id === selectedTableId);
  const availableTables = tables.filter((t) => t.status === 'AVAILABLE' && t.id !== selectedTableId);

  // Total acumulado de la mesa = suma de TODOS sus pedidos activos. Una mesa
  // puede tener varios (el comensal pide por QR + el mesero carga otro), así
  // que `orderDetail.total` —un solo pedido— no alcanza como cuenta de la mesa.
  const tableTotal = (selectedTable?.orders ?? []).reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <main className="min-h-screen bg-background p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-xl font-semibold">Meseros — Mapa de mesas</h1>
        </div>
        {/* flex-wrap: en el teléfono los controles bajan a otra línea en vez de
            desbordar (el mozo trabaja desde el celular). El select se acota para
            que un nombre de sucursal largo no empuje todo fuera de pantalla. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            aria-label="Sucursal"
            className="input min-w-0 max-w-[45vw] sm:max-w-none"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setMergeMode((m) => !m);
              setMergeSelection([]);
            }}
            aria-pressed={mergeMode}
            className={`btn btn-lg ${mergeMode ? 'btn-primary' : ''}`}
          >
            {mergeMode ? 'Cancelar unión' : 'Unir mesas'}
          </button>
          <ThemeToggle />
          <button onClick={onLogout} className="btn btn-lg" aria-label="Salir">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Salir
          </button>
        </div>
      </header>

      {error && <Alert tone="error" className="mb-3">{error}</Alert>}

      {readyNotice && (
        <div className="alert-ok mb-3 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-medium">
            <BellRing className="h-5 w-5 shrink-0 animate-pulse" aria-hidden="true" />
            {readyNotice}
          </span>
          <button
            onClick={() => setReadyNotice(null)}
            className="btn btn-ghost btn-sm shrink-0"
            aria-label="Descartar aviso"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {mergeMode && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
          Seleccioná 2+ mesas (la primera que toques es la primaria). Elegidas:{' '}
          <span className="tabular font-semibold">{mergeSelection.length}</span>
          <button onClick={onMerge} disabled={busy || mergeSelection.length < 2} className="btn btn-primary btn-lg">
            Confirmar unión
          </button>
        </div>
      )}

      {/* 3 columnas en el teléfono, no 4: con 4, cada tarjeta quedaba en ~80px
          y el badge de estado ("En espera") no entraba y desbordaba la pantalla.
          Con 3 la tarjeta respira y el estado se lee. */}
      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6 md:grid-cols-8">
        {tables.map((t) => {
          const active = t.orders[0];
          const badge = tableBadge(t, active);
          const isSelected = mergeMode ? mergeSelection.includes(t.id) : selectedTableId === t.id;
          return (
            <button
              key={t.id}
              onClick={() => selectTable(t)}
              aria-pressed={isSelected}
              className={`card card-interactive min-h-[5.5rem] p-3 text-left ${
                isSelected ? 'border-primary bg-primary/10' : ''
              }`}
            >
              <div className="mb-1.5 font-heading text-base font-semibold">Mesa {t.code}</div>
              <Badge tone={badge.tone} dot>
                {badge.label}
              </Badge>
              {t.orders.length > 0 && (
                <div className="tabular mt-1.5 text-xs text-muted-foreground">
                  {formatMoney(
                    t.orders.reduce((sum, o) => sum + Number(o.total), 0),
                    countryCode,
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {!mergeMode && selectedTable && (
        <div className="panel p-4">
          <h2 className="mb-3 font-heading text-lg font-medium">Mesa {selectedTable.code}</h2>

          {selectedTable.status === 'AVAILABLE' && (
            <button onClick={() => onOpenTable(selectedTable.id)} disabled={busy} className="btn btn-primary btn-lg">
              Abrir mesa
            </button>
          )}

          {selectedTable.status !== 'AVAILABLE' && !orderDetail && (
            <div>
              <p className="mb-3 text-sm text-muted-foreground">Sin pedido activo — creá uno:</p>
              <ItemPicker
                menuItems={menuItems}
                pickItem={pickItem}
                setPickItem={setPickItem}
                pickQty={pickQty}
                setPickQty={setPickQty}
                pickNotes={pickNotes}
                setPickNotes={setPickNotes}
                pickMods={pickMods}
                setPickMods={setPickMods}
                countryCode={countryCode}
                cart={cart}
                setCart={setCart}
                addToCart={addToCart}
              />
              <button onClick={onCreateOrder} disabled={busy || cart.length === 0} className="btn btn-primary btn-lg">
                Enviar pedido a cocina
              </button>
            </div>
          )}

          {orderDetail && (
            <div>
              <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
                {orderDetail.items.map((it) => {
                  const editable = orderDetail.status !== 'COMPLETED' && orderDetail.status !== 'CANCELLED';
                  const busy = itemBusy === it.id;
                  return (
                    <li key={it.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="tabular">{it.quantity}×</span> {it.menuItem.name}{' '}
                        <span className="tabular">({formatMoney(Number(it.unitPrice), countryCode)})</span>
                        {it.round > 1 && (
                          <span className="ml-1 text-xs text-muted-foreground">· ronda {it.round}</span>
                        )}
                      </span>
                      {editable && (
                        <span className="flex shrink-0 items-center gap-1">
                          {/* −/+ cambian la cantidad de un ítem ya enviado; la X lo
                              quita (pide confirmación). El backend recalcula el
                              total y avisa a cocina. */}
                          <button
                            type="button"
                            onClick={() => onChangeItemQty(it.id, it.quantity - 1)}
                            disabled={busy || it.quantity <= 1}
                            className="btn btn-ghost h-11 w-11 shrink-0 justify-center p-0"
                            aria-label={`Restar uno a ${it.menuItem.name}`}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onChangeItemQty(it.id, it.quantity + 1)}
                            disabled={busy}
                            className="btn btn-ghost h-11 w-11 shrink-0 justify-center p-0"
                            aria-label={`Sumar uno a ${it.menuItem.name}`}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`¿Quitar ${it.menuItem.name} del pedido?`)) onRemoveItem(it.id);
                            }}
                            disabled={busy}
                            className="btn btn-ghost h-11 w-11 shrink-0 justify-center p-0 text-error-foreground"
                            aria-label={`Quitar ${it.menuItem.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mb-1 text-sm font-medium">
                Total de este pedido: <span className="tabular">{formatMoney(orderDetail.total, countryCode)}</span>
              </p>
              {/* Cuenta de la mesa: suma de todos los pedidos activos, no solo el
                  que se está viendo arriba. Es el número que se cobra. */}
              <p className="mb-4 font-heading text-base font-semibold">
                Total de la mesa: <span className="tabular">{formatMoney(tableTotal, countryCode)}</span>
              </p>

              {/* Agregar una ronda a la mesa abierta — el flujo "agregame un
                  postre". Antes no existía: al haber pedido activo, la carga de
                  productos desaparecía y no había forma de sumar. */}
              <details className="mb-4 rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium text-primary">
                  + Agregar productos a esta mesa
                </summary>
                <div className="mt-3">
                  <ItemPicker
                    menuItems={menuItems}
                    pickItem={pickItem}
                    setPickItem={setPickItem}
                    pickQty={pickQty}
                    setPickQty={setPickQty}
                    pickNotes={pickNotes}
                    setPickNotes={setPickNotes}
                    pickMods={pickMods}
                    setPickMods={setPickMods}
                    countryCode={countryCode}
                    cart={cart}
                    setCart={setCart}
                    addToCart={addToCart}
                  />
                  <button onClick={onAddRound} disabled={busy || cart.length === 0} className="btn btn-primary btn-lg">
                    Enviar ronda a cocina
                  </button>
                </div>
              </details>

              <div className="flex flex-wrap items-center gap-2">
                <select onChange={(e) => e.target.value && onTransfer(e.target.value)} defaultValue="" aria-label="Transferir la mesa a otra" className="input">
                  <option value="" disabled>
                    Transferir a...
                  </option>
                  {availableTables.map((t) => (
                    <option key={t.id} value={t.id}>
                      Mesa {t.code}
                    </option>
                  ))}
                </select>

                <button onClick={onRequestBill} disabled={busy} className="btn btn-lg">
                  {orderDetail.billRequestedAt ? (
                    <>
                      <Check className="h-4 w-4 text-ok" aria-hidden="true" />
                      Cuenta solicitada
                    </>
                  ) : (
                    <>
                      <Receipt className="h-4 w-4" aria-hidden="true" />
                      Solicitar cuenta
                    </>
                  )}
                </button>
              </div>

              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 font-heading text-sm font-medium">Dividir cuenta (por persona)</p>
                {splitParts.map((p, idx) => (
                  <div key={idx} className="mb-1 flex gap-2">
                    <input
                      value={p.label}
                      onChange={(e) =>
                        setSplitParts((parts) => parts.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                      }
                      aria-label={`Nombre de la persona ${idx + 1}`}
                      className="input w-32"
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="Monto"
                      value={p.amount}
                      onChange={(e) =>
                        setSplitParts((parts) => parts.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))
                      }
                      aria-label={`Monto que paga la persona ${idx + 1}`}
                      className="input tabular w-28"
                    />
                    {/* Se podían agregar personas pero no sacarlas: un toque de
                        más obligaba a recargar la pantalla. */}
                    {splitParts.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setSplitParts((parts) => parts.filter((_, i) => i !== idx))}
                        aria-label={`Quitar a la persona ${idx + 1}`}
                        className="btn btn-ghost h-11 w-11 shrink-0 justify-center p-0 text-error-foreground"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSplitParts((parts) => [...parts, { label: `Persona ${parts.length + 1}`, amount: '' }])}
                    className="btn btn-lg"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Agregar persona
                  </button>
                  <button onClick={onSplit} disabled={busy} className="btn btn-primary btn-lg">
                    Confirmar división
                  </button>
                </div>
                {splitNotice && (
                  <Alert tone="ok" className="mt-3">
                    {splitNotice}
                  </Alert>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

/**
 * Selector de producto + carrito, compartido entre crear un pedido nuevo y
 * agregar una ronda a una mesa abierta. El estado vive en el padre (un solo
 * carrito por vez, porque los dos usos son mutuamente excluyentes).
 */
function ItemPicker(props: {
  menuItems: MenuItemRow[];
  pickItem: string;
  setPickItem: (v: string) => void;
  pickQty: string;
  setPickQty: (v: string) => void;
  pickNotes: string;
  setPickNotes: (v: string) => void;
  pickMods: string[];
  setPickMods: (ids: string[]) => void;
  countryCode: string;
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  addToCart: () => void;
}) {
  const { menuItems, cart, setCart } = props;
  const selectedItem = menuItems.find((m) => m.id === props.pickItem);
  const groups = selectedItem?.modifierGroups ?? [];
  // Bloquea "Agregar" sin producto o con un grupo obligatorio sin cubrir.
  const canAdd = !!props.pickItem && modifiersSatisfied(groups, props.pickMods);

  /** Nombres de los extras elegidos en una línea — para el preview del carrito. */
  function modNamesOf(line: CartLine): string[] {
    const item = menuItems.find((m) => m.id === line.menuItemId);
    if (!item) return [];
    return item.modifierGroups
      .flatMap((g) => g.options)
      .filter((o) => line.modifierOptionIds.includes(o.id))
      .map((o) => o.name);
  }

  /** Componentes del combo de una línea (vacío si el producto no es combo). */
  function comboOf(line: CartLine): { quantity: number; name: string }[] {
    const item = menuItems.find((m) => m.id === line.menuItemId);
    if (!item?.isCombo) return [];
    return item.comboComponents.map((c) => ({ quantity: c.quantity, name: c.component.name }));
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={props.pickItem}
          onChange={(e) => {
            props.setPickItem(e.target.value);
            // Al cambiar de producto, los extras del anterior ya no aplican.
            props.setPickMods([]);
          }}
          className="input"
        >
          <option value="">Producto...</option>
          {menuItems.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({formatMoney(Number(m.price), props.countryCode)})
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          value={props.pickQty}
          onChange={(e) => props.setPickQty(e.target.value)}
          className="input tabular w-20"
          aria-label="Cantidad"
        />
        <button onClick={props.addToCart} type="button" disabled={!canAdd} className="btn btn-lg">
          Agregar
        </button>
      </div>

      {/* Combo elegido: no tiene extras, pero conviene mostrar qué trae antes de
          sumarlo al pedido. */}
      {selectedItem?.isCombo && selectedItem.comboComponents.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge tone="primary">Combo</Badge>
          <span>
            Incluye: {selectedItem.comboComponents.map((c) => `${c.quantity}× ${c.component.name}`).join(' · ')}
          </span>
        </div>
      )}

      {/* Extras del producto elegido (queso extra, bacon, punto de cocción...).
          Sólo aparece si el producto tiene grupos de modificadores. */}
      {groups.length > 0 && (
        <div className="mb-3">
          <ItemModifierPicker
            groups={groups}
            selected={props.pickMods}
            onChange={props.setPickMods}
            countryCode={props.countryCode}
          />
        </div>
      )}

      {/* La nota va por línea: "sin cebolla" aplica a ese plato, no a la mesa. */}
      <input
        type="text"
        value={props.pickNotes}
        onChange={(e) => props.setPickNotes(e.target.value)}
        maxLength={300}
        placeholder="Nota para cocina (ej: sin cebolla)"
        className="input mb-3 w-full"
        aria-label="Nota para cocina del producto a agregar"
      />
      {cart.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {cart.map((line, idx) => {
            const mods = modNamesOf(line);
            const combo = comboOf(line);
            return (
              <li key={idx} className="flex items-start justify-between gap-2">
                <span>
                  <span className="tabular">{line.quantity}×</span>{' '}
                  {menuItems.find((m) => m.id === line.menuItemId)?.name}
                  {combo.length > 0 && (
                    <>
                      {' '}
                      <Badge tone="primary">Combo</Badge>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Incluye: {combo.map((c) => `${c.quantity}× ${c.name}`).join(' · ')}
                      </span>
                    </>
                  )}
                  {mods.length > 0 && (
                    <span className="mt-0.5 block text-xs text-info-foreground">{mods.join(' · ')}</span>
                  )}
                  {line.notes && (
                    <span className="mt-0.5 block text-xs font-medium text-warn-foreground">{line.notes}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setCart((c) => c.filter((_, i) => i !== idx))}
                  className="btn btn-ghost btn-sm shrink-0"
                  aria-label={`Quitar ${menuItems.find((m) => m.id === line.menuItemId)?.name} del pedido`}
                >
                  Quitar
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
