'use client';

import { useEffect, useState } from 'react';
import { Ban, FileText, Plus, ReceiptText, Send, Undo2, X } from 'lucide-react';
import { api, type ApiError } from '@/lib/api-client';
import { formatMoney } from '@chillberry/domain';
import { ItemModifierPicker, modifiersSatisfied, type ModifierGroupView } from '@/components/item-modifier-picker';
import { Alert, Badge, EmptyState, PageHeader, Skeleton, type Tone } from '@/components/ui';

type Branch = { id: string; name: string };
type TableRow = { id: string; code: string };
type MenuItem = {
  id: string;
  name: string;
  price: string;
  modifierGroups: ModifierGroupView[];
  /** Un combo se vende como ítem normal; estos campos son sólo para mostrar
   *  qué trae. No cambian cómo se agrega al pedido. */
  isCombo: boolean;
  comboComponents: { quantity: number; component: { id: string; name: string } }[];
};
type CartLine = { menuItemId: string; quantity: number; notes?: string; modifierOptionIds: string[] };
type OrderItemModifier = { groupName: string; optionName: string; priceDelta: string };
type OrderItem = {
  id: string;
  quantity: number;
  unitPrice: string;
  notes: string | null;
  modifiers: OrderItemModifier[] | null;
  menuItem: { name: string };
};
type Order = {
  id: string;
  status: string;
  total: string;
  createdAt: string;
  table: { code: string } | null;
  items: OrderItem[];
};

type TenantSettings = { id: string; name: string; countryCode: string; currency: string; timezone: string };

/** Comprobante fiscal de un pedido — shape del row `Invoice` que devuelve
 *  `GET /invoices/:orderId`. `totalAmount` viene como string (Decimal). */
type Invoice = {
  id: string;
  orderId: string;
  kind: string;
  series: string;
  number: string;
  status: string;
  totalAmount: string;
  issuedAt: string | null;
  createdAt: string;
};

const INVOICE_KIND_LABEL: Record<string, string> = {
  RECEIPT: 'Recibo',
  FISCAL_INVOICE: 'Factura',
  CREDIT_NOTE: 'Nota de crédito',
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitido',
  CANCELLED: 'Anulado',
};

const INVOICE_STATUS_TONE: Record<string, Tone> = {
  ISSUED: 'ok',
  CANCELLED: 'error',
  DRAFT: 'neutral',
};

/** Estados terminales: no se avanzan ni se cancelan. */
const TERMINAL_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

const NEXT_STATUS: Record<string, { label: string; next: string } | undefined> = {
  WAITING: { label: 'Aceptar', next: 'ACCEPTED' },
  ACCEPTED: { label: 'Preparar', next: 'PREPARING' },
  PREPARING: { label: 'Marcar listo', next: 'READY' },
  READY: { label: 'Completar', next: 'COMPLETED' },
};

const STATUS_TONE: Record<string, Tone> = {
  COMPLETED: 'ok',
  CANCELLED: 'error',
  READY: 'info',
  PREPARING: 'info',
};

/** Los estados sin entrada explícita (WAITING, ACCEPTED) van en `warn`, como
 *  en el diseño anterior: son los que todavía esperan una acción. */
const STATUS_TONE_FALLBACK: Tone = 'warn';

export default function OrdersPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tables, setTables] = useState<TableRow[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [orderLimit, setOrderLimit] = useState(50);
  // Carga inicial de los datos de la sucursal (mesas + menú + pedidos). Sin
  // esto, un GET fallido/lento se veía igual que "no hay pedidos" (cuenta vacía)
  // y el usuario no tenía forma de distinguir una caída de una cuenta sin datos.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tableId, setTableId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickItem, setPickItem] = useState('');
  const [pickQty, setPickQty] = useState('1');
  const [pickNotes, setPickNotes] = useState('');
  const [pickMods, setPickMods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState('PY');

  // Cancelación con motivo obligatorio (mismo criterio anti-fraude que el
  // descuento: quién y por qué quedan registrados).
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  // Reembolso (total o parcial) de un pedido cobrado.
  const [refundId, setRefundId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundNotice, setRefundNotice] = useState<string | null>(null);

  // Modal de comprobante.
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  async function loadBranches() {
    const b = await api.get<Branch[]>('/branches');
    setBranches(b);
    if (!branchId && b[0]) setBranchId(b[0].id);
    return b;
  }

  async function loadForBranch(forBranchId: string) {
    if (!forBranchId) return;
    const orderQuery: Record<string, string> = { branchId: forBranchId, limit: String(orderLimit) };
    if (statusFilter !== 'ALL') orderQuery.status = statusFilter;
    const [t, m, o] = await Promise.all([
      api.get<TableRow[]>('/tables', { query: { branchId: forBranchId } }),
      api.get<MenuItem[]>('/menu/items', { query: { branchId: forBranchId } }),
      api.get<Order[]>('/orders', { query: orderQuery }),
    ]);
    setTables(t);
    setMenuItems(m);
    setOrders(o);
  }

  useEffect(() => {
    loadBranches()
      .then((b) => {
        // Sin sucursales no corre el segundo load (loadForBranch corta con
        // branchId vacío): cerramos el loading acá para mostrar el estado vacío.
        if (b.length === 0) setLoading(false);
      })
      .catch((err) => {
        setLoadError((err as ApiError).message);
        setLoading(false);
      });
    api
      .get<TenantSettings>('/tenant-settings')
      .then((s) => setCountryCode(s.countryCode))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadForBranch(branchId)
      .catch((err) => {
        if (!cancelled) setLoadError((err as ApiError).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, statusFilter, orderLimit]);

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

  async function createOrder() {
    setError(null);
    try {
      await api.post('/orders', {
        branchId,
        tableId: tableId || undefined,
        // Sólo ids de extras, nunca precios: el server resuelve los deltas.
        items: cart.map((l) => ({
          menuItemId: l.menuItemId,
          quantity: l.quantity,
          notes: l.notes,
          modifierOptionIds: l.modifierOptionIds.length > 0 ? l.modifierOptionIds : undefined,
        })),
      });
      setCart([]);
      setTableId('');
      await loadForBranch(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function advance(order: Order) {
    const action = NEXT_STATUS[order.status];
    if (!action) return;
    try {
      await api.patch(`/orders/${order.id}/status`, { status: action.next });
      await loadForBranch(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  function openRefund(o: Order) {
    setRefundId(o.id);
    setRefundAmount(String(Number(o.total))); // arranca en el total (reembolso total)
    setRefundReason('');
    setRefundNotice(null);
  }

  async function confirmRefund(orderId: string) {
    const reason = refundReason.trim();
    const amount = Number(refundAmount);
    if (reason.length < 3 || !Number.isFinite(amount) || amount <= 0) return;
    setError(null);
    setRefundNotice(null);
    setRefundBusy(true);
    try {
      const res = await api.post<{ fullyRefunded: boolean; totalRefunded: number }>(
        `/pos/orders/${orderId}/refund`,
        { amount, reason },
      );
      setRefundId(null);
      setRefundReason('');
      setRefundNotice(
        res.fullyRefunded ? 'Reembolso total registrado.' : `Reembolso parcial registrado (${formatMoney(res.totalRefunded, countryCode)} devueltos en total).`,
      );
      await loadForBranch(branchId);
    } catch (err) {
      // 409 si no hay caja abierta / pedido no cobrado; 400 si el monto excede.
      setError((err as ApiError).message);
    } finally {
      setRefundBusy(false);
    }
  }

  async function confirmCancel(orderId: string) {
    const reason = cancelReason.trim();
    if (reason.length < 3) return;
    setError(null);
    setCancelBusy(true);
    try {
      await api.patch(`/orders/${orderId}/status`, { status: 'CANCELLED', reason });
      setCancelId(null);
      setCancelReason('');
      await loadForBranch(branchId);
    } catch (err) {
      // El backend rechaza motivo corto / transición inválida con 400.
      setError((err as ApiError).message);
    } finally {
      setCancelBusy(false);
    }
  }

  async function openInvoice(order: Order) {
    setInvoiceOrder(order);
    setInvoice(null);
    setInvoiceError(null);
    setInvoiceLoading(true);
    try {
      const inv = await api.get<Invoice>(`/invoices/${order.id}`);
      setInvoice(inv);
    } catch (err) {
      const apiErr = err as ApiError;
      setInvoiceError(
        apiErr.status === 404
          ? 'Todavía no se emitió comprobante para este pedido. Se genera al cobrarlo en caja.'
          : apiErr.message,
      );
    } finally {
      setInvoiceLoading(false);
    }
  }

  function closeInvoice() {
    setInvoiceOrder(null);
    setInvoice(null);
    setInvoiceError(null);
  }

  // Extras del producto actualmente elegido en el quick-create.
  const selectedItem = menuItems.find((m) => m.id === pickItem);
  const pickGroups = selectedItem?.modifierGroups ?? [];
  const canAddToCart = !!pickItem && modifiersSatisfied(pickGroups, pickMods);

  return (
    <div>
      <PageHeader title="Pedidos" description="Lo que está pasando ahora en el salón y en la cocina." />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="orders-branch" className="label mb-1.5">
            Sucursal
          </label>
          <select
            id="orders-branch"
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
        <div>
          <label htmlFor="orders-status" className="label mb-1.5">
            Estado
          </label>
          <select
            id="orders-status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setOrderLimit(50); // reset paginación al cambiar filtro
            }}
            className="input w-full sm:w-48"
          >
            <option value="ALL">Todos</option>
            {['WAITING', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {refundNotice && (
        <Alert tone="ok" className="mb-4">
          {refundNotice}
        </Alert>
      )}

      <div className="panel mb-8 p-5">
        <h2 className="mb-3 font-heading text-lg font-semibold">Nuevo pedido</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            className="input w-full sm:w-48"
            aria-label="Mesa"
          >
            <option value="">Sin mesa (takeaway)</option>
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                Mesa {t.code}
              </option>
            ))}
          </select>

          <select
            value={pickItem}
            onChange={(e) => {
              setPickItem(e.target.value);
              // Al cambiar de producto, los extras del anterior ya no aplican.
              setPickMods([]);
            }}
            className="input w-full sm:w-64"
            aria-label="Producto"
          >
            <option value="">Producto...</option>
            {menuItems.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({formatMoney(m.price, countryCode)})
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={pickQty}
            onChange={(e) => setPickQty(e.target.value)}
            className="input w-20"
            aria-label="Cantidad"
          />
          <input
            type="text"
            value={pickNotes}
            onChange={(e) => setPickNotes(e.target.value)}
            maxLength={300}
            placeholder="Nota (ej: sin sal)"
            className="input w-full sm:w-56"
            aria-label="Nota para cocina del producto"
          />
          <button onClick={addToCart} type="button" disabled={!canAddToCart} className="btn">
            <Plus className="h-4 w-4" />
            Agregar al pedido
          </button>
        </div>

        {/* Combo elegido: no tiene extras, pero conviene mostrar qué trae. */}
        {selectedItem?.isCombo && selectedItem.comboComponents.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="primary">Combo</Badge>
            <span>
              Incluye: {selectedItem.comboComponents.map((c) => `${c.quantity}× ${c.component.name}`).join(' · ')}
            </span>
          </div>
        )}

        {/* Extras del producto elegido. Sólo si el producto tiene modificadores. */}
        {pickGroups.length > 0 && (
          <div className="mb-3 max-w-md">
            <ItemModifierPicker
              groups={pickGroups}
              selected={pickMods}
              onChange={setPickMods}
              countryCode={countryCode}
            />
          </div>
        )}

        {cart.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {cart.map((line, idx) => {
              const item = menuItems.find((m) => m.id === line.menuItemId);
              const modNames = item
                ? item.modifierGroups
                    .flatMap((g) => g.options)
                    .filter((o) => line.modifierOptionIds.includes(o.id))
                    .map((o) => o.name)
                : [];
              return (
                <li key={idx}>
                  <span className="tabular">{line.quantity}×</span> {item?.name ?? line.menuItemId}
                  {item?.isCombo && (
                    <>
                      {' '}
                      <Badge tone="primary">Combo</Badge>
                      <span className="ml-1 text-xs text-muted-foreground">
                        Incluye: {item.comboComponents.map((c) => `${c.quantity}× ${c.component.name}`).join(' · ')}
                      </span>
                    </>
                  )}
                  {modNames.length > 0 && (
                    <span className="ml-1 text-xs text-info-foreground">{modNames.join(' · ')}</span>
                  )}
                  {line.notes && <span className="ml-1 text-xs text-warn-foreground">({line.notes})</span>}
                </li>
              );
            })}
          </ul>
        )}

        <button onClick={createOrder} disabled={cart.length === 0} className="btn btn-primary">
          <Send className="h-4 w-4" />
          Enviar pedido
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}

      {loadError && !loading && (
        <Alert tone="error" className="mb-4">
          {loadError}
        </Alert>
      )}

      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id} className="card card-dense p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-heading font-medium text-foreground">
                  {o.table ? `Mesa ${o.table.code}` : 'Takeaway'}
                </span>
                <Badge tone={STATUS_TONE[o.status] ?? STATUS_TONE_FALLBACK} dot>
                  {o.status}
                </Badge>
                <span className="text-muted-foreground">
                  Total <span className="tabular font-medium text-foreground">{formatMoney(o.total, countryCode)}</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {o.status === 'COMPLETED' && (
                  <button onClick={() => openInvoice(o)} type="button" className="btn btn-sm">
                    <FileText className="h-4 w-4" />
                    Ver comprobante
                  </button>
                )}
                {o.status === 'COMPLETED' && (
                  <button onClick={() => openRefund(o)} type="button" className="btn btn-sm btn-danger">
                    <Undo2 className="h-4 w-4" />
                    Reembolsar
                  </button>
                )}
                {NEXT_STATUS[o.status] && (
                  <button onClick={() => advance(o)} type="button" className="btn btn-sm">
                    {NEXT_STATUS[o.status]!.label}
                  </button>
                )}
                {!TERMINAL_STATUSES.has(o.status) && (
                  <button
                    onClick={() => {
                      setCancelId(o.id);
                      setCancelReason('');
                    }}
                    type="button"
                    className="btn btn-sm btn-danger"
                  >
                    <Ban className="h-4 w-4" />
                    Cancelar
                  </button>
                )}
              </span>
            </div>

            {cancelId === o.id && (
              <div className="mb-2 border-t border-border pt-3">
                <label htmlFor={`cancel-reason-${o.id}`} className="label mb-1.5">
                  Motivo de la cancelación
                </label>
                <input
                  id={`cancel-reason-${o.id}`}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="input mb-2 w-full"
                  placeholder="Ej. la mesa se retiró antes de que saliera el pedido"
                  maxLength={300}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => confirmCancel(o.id)}
                    disabled={cancelReason.trim().length < 3 || cancelBusy}
                    type="button"
                    className="btn btn-sm btn-danger"
                  >
                    {cancelBusy ? 'Cancelando...' : 'Confirmar cancelación'}
                  </button>
                  <button
                    onClick={() => {
                      setCancelId(null);
                      setCancelReason('');
                    }}
                    type="button"
                    className="btn btn-sm btn-ghost"
                  >
                    No cancelar
                  </button>
                  <span className="text-xs text-muted-foreground">Mínimo 3 caracteres.</span>
                </div>
              </div>
            )}

            {refundId === o.id && (
              <div className="mb-2 border-t border-border pt-3">
                <div className="mb-2 flex flex-wrap items-end gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Monto a reembolsar</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="input tabular w-36"
                    />
                  </label>
                  <span className="pb-2 text-xs text-muted-foreground">
                    Total del pedido {formatMoney(o.total, countryCode)} — dejalo así para total, o bajalo para parcial.
                  </span>
                </div>
                <input
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="input mb-2 w-full"
                  placeholder="Motivo del reembolso (ej. producto en mal estado)"
                  maxLength={300}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => confirmRefund(o.id)}
                    disabled={refundReason.trim().length < 3 || !(Number(refundAmount) > 0) || refundBusy}
                    type="button"
                    className="btn btn-sm btn-danger"
                  >
                    {refundBusy ? 'Reembolsando...' : 'Confirmar reembolso'}
                  </button>
                  <button
                    onClick={() => setRefundId(null)}
                    type="button"
                    className="btn btn-sm btn-ghost"
                  >
                    No reembolsar
                  </button>
                  <span className="text-xs text-muted-foreground">Requiere caja abierta.</span>
                </div>
              </div>
            )}

            <ul className="text-muted-foreground">
              {o.items.map((it) => (
                <li key={it.id}>
                  <span className="tabular">{it.quantity}×</span> {it.menuItem.name}{' '}
                  <span className="tabular">({formatMoney(it.unitPrice, countryCode)})</span>
                  {it.modifiers?.map((m, i) => (
                    <span key={`${it.id}-${i}`} className="ml-1 text-xs text-info-foreground">
                      +{m.optionName}
                    </span>
                  ))}
                  {it.notes && <span className="ml-1 text-xs text-warn-foreground">({it.notes})</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {!loading && !loadError && orders.length === 0 && (
        <EmptyState
          icon={ReceiptText}
          title="No hay pedidos"
          description="No hay pedidos que coincidan con el filtro. Cuando entre uno — por QR o cargado a mano — lo vas a ver acá."
        />
      )}

      {/* Paginación: si la lista llegó al límite, probablemente hay más. */}
      {!loading && orders.length >= orderLimit && (
        <div className="mt-4 text-center">
          <button onClick={() => setOrderLimit((n) => n + 50)} className="btn">
            Cargar más
          </button>
        </div>
      )}

      {invoiceOrder && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={closeInvoice}
          role="presentation"
        >
          <div
            className="card w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Comprobante del pedido"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold">Comprobante</h2>
              <button type="button" onClick={closeInvoice} className="btn btn-ghost btn-icon" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>

            {invoiceLoading && <p className="text-sm text-muted-foreground">Cargando comprobante...</p>}

            {!invoiceLoading && invoiceError && <Alert tone="warn">{invoiceError}</Alert>}

            {!invoiceLoading && invoice && (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular font-heading text-base font-medium">
                    {invoice.series}-{invoice.number}
                  </span>
                  <Badge tone={INVOICE_STATUS_TONE[invoice.status] ?? 'neutral'}>
                    {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground">
                  {INVOICE_KIND_LABEL[invoice.kind] ?? invoice.kind}
                  {invoiceOrder.table ? ` · Mesa ${invoiceOrder.table.code}` : ' · Takeaway'}
                </p>

                <ul className="space-y-1 border-t border-border pt-2 text-muted-foreground">
                  {invoiceOrder.items.map((it) => (
                    <li key={it.id} className="flex justify-between gap-2">
                      <span>
                        <span className="tabular">{it.quantity}×</span> {it.menuItem.name}
                      </span>
                      <span className="tabular shrink-0">
                        {formatMoney(Number(it.unitPrice) * it.quantity, countryCode)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between border-t border-border pt-2 font-medium">
                  <span>Total</span>
                  <span className="tabular">{formatMoney(invoice.totalAmount, countryCode)}</span>
                </div>

                <p className="text-xs text-muted-foreground">
                  Emitido: {invoice.issuedAt ? new Date(invoice.issuedAt).toLocaleString('es-PY') : '—'}
                  {' · '}Creado: {new Date(invoice.createdAt).toLocaleString('es-PY')}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
