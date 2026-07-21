'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Banknote,
  Calculator,
  ClipboardList,
  CreditCard,
  Gift,
  LogOut,
  Plus,
  Receipt,
  Undo2,
  X,
} from 'lucide-react';
import { formatMoney } from '@chillberry/domain';
import { api, type ApiError } from '@/lib/api-client';
import { logout } from '@/lib/auth';
import { connectKitchenSocket } from '@/lib/socket';
import { Alert, Badge, EmptyState } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/components/toast';
import { printSalesReceipt, type SalesReceiptData } from '@/lib/tickets';
import { ORDER_STATUS_LABEL } from '@/lib/status-labels';

// Fallback mientras `/tenant-settings` todavía no respondió (ver loadTenantSettings) —
// no debe llegar `undefined` a formatMoney.
const FALLBACK_COUNTRY_CODE = 'PY';

type TenantSettings = { id: string; name: string; countryCode: string; currency: string; timezone: string };

type Branch = { id: string; name: string };
type CashSession = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openingAmount: string;
  expectedCash: string | null;
  countedCash: string | null;
  difference: string | null;
};
// El cierre devuelve, además de esperado/contado/diferencia, cuánto de lo
// contado son propinas en efectivo (van al mozo, no son venta). Se muestra
// aparte para que el cajero vea el split venta-vs-propina.
type CloseSummary = {
  expectedCash: string | null;
  countedCash: string | null;
  difference: string | null;
  cashTips: number;
};
type PendingOrder = {
  id: string;
  status: string;
  total: string;
  subtotal: string;
  discountTotal: string;
  // El pedido guarda el teléfono del cliente (Order.customerPhone en el
  // backend). Puede venir null: mesa sin identificar, takeaway anónimo, etc.
  customerPhone: string | null;
  billRequestedAt: string | null;
  table: { code: string } | null;
  items: { id: string; quantity: number; unitPrice: string; menuItem: { name: string } }[];
  billSplits: { id: string; label: string; amount: string; paid: boolean }[];
};
type LoyaltyAccount = { id: string; phone: string; name: string | null; points: number };
type RedeemResult = {
  pointsRedeemed: number;
  discountAmount: number;
  remainingPoints: number;
  newOrderTotal: number;
};
type Invoice = { series: string; number: string; totalAmount: string; issuedAt: string };

type PaymentLine = { method: string; amount: string; provider?: string };

export default function PosPage() {
  const router = useRouter();
  const { notify } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [tenantSettings, setTenantSettings] = useState<TenantSettings | null>(null);
  const countryCode = tenantSettings?.countryCode ?? FALLBACK_COUNTRY_CODE;
  const [session, setSession] = useState<CashSession | null>(null);
  const [openingAmount, setOpeningAmount] = useState('0');
  const [countedCash, setCountedCash] = useState('');
  // Resultado del último cierre — se muestra inline tras cerrar (incluye el
  // desglose de propinas en efectivo). Se limpia al abrir otra caja o cambiar
  // de sucursal.
  const [closeSummary, setCloseSummary] = useState<CloseSummary | null>(null);

  // Movimiento de caja (retiro/ingreso) — modal disponible con la caja abierta.
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementType, setMovementType] = useState<'PAY_IN' | 'PAY_OUT'>('PAY_OUT');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementNote, setMovementNote] = useState('');
  const [movementSubmitting, setMovementSubmitting] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);

  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  // Snapshot del comprobante para reimprimir tras cobrar: el pedido sale de la
  // lista de pendientes al completarse, así que guardamos los datos acá.
  const [lastReceipt, setLastReceipt] = useState<SalesReceiptData | null>(null);
  // Reembolso de la última venta cobrada, desde el mismo POS (el cajero no ve
  // admin/orders). Sólo aplica a una venta COMPLETED.
  const [lastCharged, setLastCharged] = useState<{ id: string; total: number } | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundNotice, setRefundNotice] = useState<string | null>(null);
  // Aviso inline tras un cobro que quedó pendiente de confirmación del proveedor
  // electrónico (aún sin comprobante) — reemplaza el alert() nativo.
  const [chargeNotice, setChargeNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [discountType, setDiscountType] = useState('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  // Código del cupón que muestra el cliente. El monto NO lo tipea el cajero: lo
  // resuelve el servidor desde el cupón (y valida vigencia, tope y mínimo).
  const [discountCoupon, setDiscountCoupon] = useState('');

  const [lines, setLines] = useState<PaymentLine[]>([{ method: 'CASH', amount: '' }]);
  const [chargeSplitId, setChargeSplitId] = useState('');
  const [tip, setTip] = useState('');
  const [charging, setCharging] = useState(false);
  /** Cierre de caja en vuelo: evita el doble click sobre una acción sin vuelta atrás. */
  const [closing, setClosing] = useState(false);

  // Canje de puntos del cliente del pedido seleccionado. Es un paso PREVIO y
  // opcional al cobro: baja el total del pedido antes de cobrarlo.
  const [account, setAccount] = useState<LoyaltyAccount | null>(null);
  const [redeemPoints, setRedeemPoints] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  // Sobrevive a los re-renders del intento: si se guardara en estado, un
  // re-render entre el error y el reintento podría regenerarla y el servidor
  // ya no reconocería el replay.
  const chargeKeyRef = useRef<string | null>(null);

  async function loadBranches() {
    const b = await api.get<Branch[]>('/branches');
    setBranches(b);
    if (!branchId && b[0]) setBranchId(b[0].id);
  }

  async function loadSession(forBranchId: string) {
    if (!forBranchId) return;
    const s = await api.get<CashSession | null>('/pos/cash-sessions/open', { query: { branchId: forBranchId } });
    setSession(s);
  }

  async function loadOrders(forBranchId: string) {
    if (!forBranchId) return;
    const o = await api.get<PendingOrder[]>('/pos/orders/pending', { query: { branchId: forBranchId } });
    setOrders(o);
  }

  useEffect(() => {
    loadBranches().catch(() => {});
    api
      .get<TenantSettings>('/tenant-settings')
      .then(setTenantSettings)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // El resumen de cierre y el modal de movimiento son de la sucursal anterior:
    // limpiarlos al cambiar de sucursal para no mostrar datos cruzados.
    setCloseSummary(null);
    setMovementOpen(false);
    // Sin esto, una API caída se ve como "No hay pedidos pendientes" y el
    // cajero cree que no tiene nada que cobrar.
    loadSession(branchId).catch(() => setError('No pudimos cargar los datos. Revisá la conexión y reintentá.'));
    loadOrders(branchId).catch(() => setError('No pudimos cargar los datos. Revisá la conexión y reintentá.'));
  }, [branchId]);

  // Aviso EN VIVO a la CAJA: cuando una mesa pide la cuenta, el cajero recibe
  // sonido + pop-up y se refresca la lista de pendientes (así ve el pedido con
  // su marca de "pidió la cuenta" sin tener que refrescar a mano). Escucha en
  // el namespace `/kitchen`, room de caja por sucursal (`cash:join`).
  useEffect(() => {
    if (!branchId) return;
    const socket = connectKitchenSocket();
    socket.on('connect', () => socket.emit('cash:join', { branchId }));
    socket.on('cash:bill-requested', (payload: { tableCode: string | null; total: number }) => {
      notify({
        title: payload.tableCode ? `Mesa ${payload.tableCode}: piden la cuenta` : 'Piden la cuenta',
        description: 'Un pedido está listo para cobrar.',
        tone: 'warn',
        sound: 'bill',
      });
      loadOrders(branchId).catch(() => {});
    });
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function onOpenSession() {
    setError(null);
    // Abrir una caja nueva deja atrás el resumen del cierre anterior.
    setCloseSummary(null);
    try {
      const s = await api.post<CashSession>('/pos/cash-sessions/open', {
        branchId,
        openingAmount: Number(openingAmount),
      });
      setSession(s);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function onCloseSession() {
    if (!session || closing) return;

    // Cerrar caja es la acción más irreversible de la app y era la que menos
    // fricción tenía: con el campo vacío, `Number('') === 0` y el DTO lo acepta,
    // así que se cerraba declarando CERO efectivo contado — el arqueo registraba
    // un faltante igual a toda la caja, imputado al cajero.
    const contado = countedCash.trim();
    if (contado === '') {
      setError('Escribí cuánto efectivo contaste antes de cerrar la caja.');
      return;
    }
    const monto = Number(contado);
    if (!Number.isFinite(monto) || monto < 0) {
      setError('El efectivo contado tiene que ser un número válido.');
      return;
    }
    if (
      !window.confirm(
        `Vas a cerrar la caja declarando ${formatMoney(monto, countryCode)} contados en el cajón.\n\n` +
          'El arqueo queda registrado con la diferencia contra lo esperado y no se puede deshacer. ¿Cerramos?',
      )
    ) {
      return;
    }

    setError(null);
    setClosing(true);
    try {
      const s = await api.post<CloseSummary>(`/pos/cash-sessions/${session.id}/close`, {
        countedCash: monto,
      });
      // La caja quedó cerrada → volvemos al estado sin sesión (permite abrir la
      // próxima) y mostramos el resumen inline en vez de un alert() nativo.
      setSession(null);
      setCountedCash('');
      setCloseSummary(s);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setClosing(false);
    }
  }

  function openMovementModal() {
    setMovementType('PAY_OUT');
    setMovementAmount('');
    setMovementNote('');
    setMovementError(null);
    setMovementOpen(true);
  }

  async function onSubmitMovement() {
    if (!session || movementSubmitting) return;
    setMovementError(null);
    const amount = Number(movementAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMovementError('Ingresá un monto válido mayor a 0.');
      return;
    }
    const note = movementNote.trim();
    // El motivo es obligatorio en un retiro: plata que sale del cajón sin
    // motivo es indistinguible de un faltante cuando el dueño audita. El
    // backend también lo exige; si igual llega un 400, se muestra abajo.
    if (movementType === 'PAY_OUT' && !note) {
      setMovementError('El motivo es obligatorio para un retiro.');
      return;
    }
    setMovementSubmitting(true);
    try {
      await api.post(`/pos/cash-sessions/${session.id}/movements`, {
        type: movementType,
        amount,
        note: note || undefined,
      });
      setMovementOpen(false);
      setMovementAmount('');
      setMovementNote('');
      // Refrescar la sesión abierta para que el esperado refleje el movimiento.
      await loadSession(branchId);
    } catch (err) {
      setMovementError((err as ApiError).message);
    } finally {
      setMovementSubmitting(false);
    }
  }

  async function onRefund() {
    if (!lastCharged) return;
    const amount = Number(refundAmount);
    const reason = refundReason.trim();
    if (!(amount > 0) || reason.length < 3) return;
    setRefundBusy(true);
    setError(null);
    setRefundNotice(null);
    try {
      const res = await api.post<{ fullyRefunded: boolean; totalRefunded: number }>(
        `/pos/orders/${lastCharged.id}/refund`,
        { amount, reason },
      );
      setRefundOpen(false);
      setRefundReason('');
      setRefundNotice(
        res.fullyRefunded
          ? 'Reembolso total registrado.'
          : `Reembolso parcial registrado (${formatMoney(res.totalRefunded, countryCode)} en total).`,
      );
      await loadSession(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setRefundBusy(false);
    }
  }

  function selectOrder(order: PendingOrder) {
    setSelectedOrderId(order.id);
    setInvoice(null);
    setLastReceipt(null);
    setLastCharged(null);
    setRefundOpen(false);
    setRefundNotice(null);
    setChargeNotice(null);
    setChargeSplitId('');
    setTip('');
    const target = Number(order.total);
    setLines([{ method: 'CASH', amount: target.toString() }]);

    // Reset del bloque de puntos y, si el pedido tiene teléfono, buscar la
    // cuenta. Sin teléfono, o sin cuenta/permiso, el bloque no se muestra.
    setAccount(null);
    setRedeemPoints('');
    setRedeemError(null);
    setRedeemNotice(null);
    if (order.customerPhone) {
      api
        .get<LoyaltyAccount | null>(`/loyalty/accounts/${encodeURIComponent(order.customerPhone)}`)
        .then((acc) => setAccount(acc))
        .catch(() => {});
    }
  }

  const selectedOrder = orders.find((o) => o.id === selectedOrderId) ?? null;

  function targetAmount(): number {
    if (!selectedOrder) return 0;
    if (chargeSplitId) {
      const split = selectedOrder.billSplits.find((s) => s.id === chargeSplitId);
      return split ? Number(split.amount) : 0;
    }
    return Number(selectedOrder.total);
  }

  async function onApplyDiscount() {
    if (!selectedOrder) return;
    setError(null);
    try {
      const isCoupon = discountType === 'COUPON';
      await api.post('/pos/discounts', {
        orderId: selectedOrder.id,
        type: discountType,
        // En un cupón el monto lo pone el servidor; se manda 0 sólo porque el
        // DTO comparte el campo con los otros dos tipos.
        value: isCoupon ? 0 : Number(discountValue),
        couponCode: isCoupon ? discountCoupon.trim() : undefined,
        reason: discountReason.trim(),
      });
      setDiscountValue('');
      setDiscountCoupon('');
      setDiscountReason('');
      await loadOrders(branchId);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  function updateLine(idx: number, patch: Partial<PaymentLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function onRedeem() {
    if (!selectedOrder || !account || redeeming) return;
    setRedeemError(null);
    setRedeemNotice(null);
    const pts = Number(redeemPoints);
    if (!Number.isInteger(pts) || pts <= 0) {
      setRedeemError('Ingresá una cantidad de puntos válida (entero mayor a 0).');
      return;
    }
    setRedeeming(true);
    try {
      const result = await api.post<RedeemResult>('/loyalty/redeem', {
        phone: account.phone,
        orderId: selectedOrder.id,
        points: pts,
      });
      // El backend puede canjear MENOS puntos de los pedidos (topea el
      // descuento al total): reflejamos el saldo real que devuelve.
      setAccount({ ...account, points: result.remainingPoints });
      setRedeemPoints('');
      setRedeemNotice(
        `Canjeados ${result.pointsRedeemed} puntos — ${formatMoney(result.discountAmount, countryCode)} de descuento. Nuevo total ${formatMoney(result.newOrderTotal, countryCode)}.`,
      );
      // El canje cambió el total del pedido: recargar para que el cobro use el
      // total nuevo.
      await loadOrders(branchId);
    } catch (err) {
      setRedeemError((err as ApiError).message);
    } finally {
      setRedeeming(false);
    }
  }

  async function onCharge() {
    if (!selectedOrder || charging) return;
    setError(null);
    setChargeNotice(null);
    setCharging(true);
    // La clave se genera UNA vez por intento y se reusa si el cobro falla y el
    // cajero reintenta: así el servidor reconoce el replay y no cobra dos
    // veces. Se regenera recién cuando el cobro sale bien (abajo).
    const key = chargeKeyRef.current ?? (chargeKeyRef.current = crypto.randomUUID());
    try {
      const tipValue = Number(tip) || 0;
      const result = await api.post<{ order: { status: string } }>(`/pos/orders/${selectedOrder.id}/charge`, {
        billSplitId: chargeSplitId || undefined,
        idempotencyKey: key,
        // La propina va en la primera línea de pago (el caso común es una sola
        // línea; en pago mixto se atribuye a la primera). El backend la guarda
        // aparte del monto y no la cuenta en la validación de que los pagos
        // cuadren con el total.
        payments: lines.map((l, i) => ({
          method: l.method,
          amount: Number(l.amount),
          provider: l.provider,
          tip: i === 0 && tipValue > 0 ? tipValue : undefined,
        })),
      });
      chargeKeyRef.current = null;
      // Snapshot ANTES de recargar: `selectedOrder` (capturado en este render)
      // sigue teniendo los datos aunque el pedido salga de la lista de pendientes.
      const receiptSnapshot: SalesReceiptData = {
        branchName: branches.find((b) => b.id === branchId)?.name ?? 'Comprobante',
        countryCode,
        tableCode: selectedOrder.table?.code ?? null,
        type: selectedOrder.table ? 'DINE_IN' : 'TAKEAWAY',
        items: selectedOrder.items.map((it) => ({
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          menuItem: { name: it.menuItem.name },
        })),
        subtotal: Number(selectedOrder.subtotal),
        total: targetAmount(),
        payments: lines.map((l) => ({ method: l.method, amount: Number(l.amount) })),
        tip: tipValue > 0 ? tipValue : null,
        now: new Date(),
        invoice: null,
      };
      await loadOrders(branchId);
      await loadSession(branchId);
      if (result.order.status === 'COMPLETED') {
        const inv = await api.get<Invoice>(`/invoices/${selectedOrder.id}`);
        setInvoice(inv);
        setLastReceipt({ ...receiptSnapshot, invoice: { series: inv.series, number: inv.number } });
        setLastCharged({ id: selectedOrder.id, total: receiptSnapshot.total });
      } else {
        setLastReceipt(receiptSnapshot);
        setChargeNotice('Pago registrado. Esperando confirmación del proveedor electrónico.');
      }
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setCharging(false);
    }
  }

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  const lineSum = lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0);

  return (
    <main className="min-h-screen bg-background p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <h1 className="font-heading text-xl font-semibold">Caja / POS</h1>
        </div>
        <div className="flex items-center gap-2">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Sucursal" className="input">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <ThemeToggle />
          <button onClick={onLogout} className="btn btn-lg" aria-label="Salir">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Salir
          </button>
        </div>
      </header>

      {error && <Alert tone="error" className="mb-3">{error}</Alert>}

      <div className="panel mb-6 p-4">
        <h2 className="mb-2 flex items-center gap-2 font-heading font-medium">
          <Banknote className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Sesión de caja
        </h2>
        {closeSummary && (
          <Alert tone="ok" className="mb-3">
            <p className="font-heading font-medium">Caja cerrada</p>
            <p className="tabular">
              Esperado {formatMoney(closeSummary.expectedCash ?? 0, countryCode)} · Contado{' '}
              {formatMoney(closeSummary.countedCash ?? 0, countryCode)} · Diferencia{' '}
              {formatMoney(closeSummary.difference ?? 0, countryCode)}
            </p>
            <p className="tabular text-sm">
              De lo contado, {formatMoney(closeSummary.cashTips, countryCode)} son propinas en efectivo.
            </p>
          </Alert>
        )}
        {!session && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value)}
              placeholder="Monto de apertura"
            aria-label="Monto de apertura de la caja"
              className="input tabular w-40"
            />
            <button onClick={onOpenSession} className="btn btn-primary btn-lg">
              Abrir caja
            </button>
          </div>
        )}
        {session && (
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="ok" dot>
              Caja abierta — apertura <span className="tabular">{formatMoney(session.openingAmount, countryCode)}</span>
            </Badge>
            <button type="button" onClick={openMovementModal} className="btn btn-lg">
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              Movimiento de caja
            </button>
            <input
              type="number"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              placeholder="Efectivo contado"
            aria-label="Efectivo contado en el cajón"
              className="input tabular w-40"
            />
            <button onClick={onCloseSession} disabled={closing} className="btn btn-lg">
              Cerrar caja
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-heading font-medium">Pedidos pendientes</h2>
          {orders.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No hay pedidos pendientes"
              description="Cuando una mesa pida la cuenta o entre un pedido nuevo, aparece acá."
            />
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => selectOrder(o)}
                    aria-pressed={selectedOrderId === o.id}
                    className={`card card-dense card-interactive w-full p-3 text-left text-sm ${
                      selectedOrderId === o.id ? 'border-primary bg-primary/10' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {o.table ? `Mesa ${o.table.code}` : 'Para llevar'} · {ORDER_STATUS_LABEL[o.status] ?? o.status}
                      </span>
                      <span className="tabular font-medium">{formatMoney(o.total, countryCode)}</span>
                    </div>
                    {o.billRequestedAt && (
                      <Badge tone="warn" className="mt-1.5">
                        Cuenta solicitada
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {selectedOrder && (
            <div className="panel p-4">
              <h2 className="mb-2 font-heading font-medium">
                {selectedOrder.table ? `Mesa ${selectedOrder.table.code}` : 'Takeaway'}
              </h2>
              <ul className="mb-2 text-sm text-muted-foreground">
                {selectedOrder.items.map((it) => (
                  <li key={it.id}>
                    <span className="tabular">{it.quantity}×</span> {it.menuItem.name}{' '}
                    <span className="tabular">({formatMoney(it.unitPrice, countryCode)})</span>
                  </li>
                ))}
              </ul>
              <div className="tabular mb-3 text-sm">
                Subtotal {formatMoney(selectedOrder.subtotal, countryCode)} · Descuento{' '}
                {formatMoney(selectedOrder.discountTotal, countryCode)} ·{' '}
                <strong>Total {formatMoney(selectedOrder.total, countryCode)}</strong>
              </div>

              {/* Canje de puntos — paso previo opcional al cobro. Se mantiene
                  visible tras canjear todo el saldo para no ocultar el aviso. */}
              {account && (account.points > 0 || redeemNotice) && (
                <div className="mb-4 border-t border-border pt-3">
                  <p className="mb-2 flex items-center gap-2 font-heading text-sm font-medium">
                    <Gift className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    Puntos del cliente: <span className="tabular">{account.points}</span>
                  </p>
                  {redeemError && (
                    <Alert tone="error" className="mb-2">
                      {redeemError}
                    </Alert>
                  )}
                  {redeemNotice && (
                    <Alert tone="ok" className="mb-2">
                      {redeemNotice}
                    </Alert>
                  )}
                  {account.points > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={account.points}
                        step={1}
                        value={redeemPoints}
                        onChange={(e) => setRedeemPoints(e.target.value)}
                        placeholder="Puntos a canjear"
                        className="input tabular w-40"
                        aria-label="Cantidad de puntos a canjear"
                      />
                      <button
                        type="button"
                        onClick={onRedeem}
                        disabled={redeeming || !redeemPoints || Number(redeemPoints) <= 0}
                        className="btn btn-lg"
                      >
                        {redeeming ? 'Canjeando...' : 'Canjear'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="mb-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} aria-label="Tipo de descuento" className="input">
                  <option value="PERCENTAGE">% Porcentaje</option>
                  <option value="FIXED_AMOUNT">Monto fijo</option>
                  <option value="COUPON">Cupón</option>
                </select>
                {discountType === 'COUPON' ? (
                  <input
                    type="text"
                    value={discountCoupon}
                    onChange={(e) => setDiscountCoupon(e.target.value.toUpperCase())}
                    placeholder="Código"
                    maxLength={40}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    className="input tabular w-36 uppercase"
                    aria-label="Código del cupón"
                  />
                ) : (
                  <input
                    type="number"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder="Valor"
                    className="input tabular w-24"
                    aria-label="Valor del descuento"
                  />
                )}
                {/* El motivo es obligatorio: un descuento sin motivo es
                    indistinguible de un robo cuando el dueño audita el turno. */}
                <input
                  type="text"
                  value={discountReason}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  placeholder="Motivo (obligatorio)"
                  maxLength={300}
                  className="input min-w-0 flex-1"
                  aria-label="Motivo del descuento"
                />
                <button
                  onClick={onApplyDiscount}
                  disabled={
                    (discountType === 'COUPON' ? discountCoupon.trim().length < 3 : !discountValue) ||
                    discountReason.trim().length < 3
                  }
                  className="btn btn-lg"
                >
                  Aplicar descuento
                </button>
              </div>

              {selectedOrder.billSplits.length > 0 && (
                <div className="mb-3 border-t border-border pt-3 text-sm">
                  <p className="mb-1 font-heading font-medium">Cuenta dividida — cobrar una parte:</p>
                  <select value={chargeSplitId} onChange={(e) => setChargeSplitId(e.target.value)} aria-label="Parte de la cuenta a cobrar" className="input">
                    <option value="">Total completo</option>
                    {selectedOrder.billSplits
                      .filter((s) => !s.paid)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} ({formatMoney(s.amount, countryCode)})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="border-t border-border pt-3">
                <p className="mb-2 flex items-center gap-2 font-heading text-sm font-medium">
                  <CreditCard className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  Cobrar <span className="tabular">{formatMoney(targetAmount(), countryCode)}</span>
                </p>
                {lines.map((line, idx) => (
                  <div key={idx} className="mb-1 flex gap-2">
                    <select
                      value={line.method}
                      onChange={(e) => updateLine(idx, { method: e.target.value })}
                      className="input"
                      aria-label={`Método de pago ${idx + 1}`}
                    >
                      <option value="CASH">Efectivo</option>
                      <option value="CARD">Tarjeta</option>
                      <option value="QR">QR</option>
                      <option value="WALLET">Billetera</option>
                    </select>
                    <input
                      type="number"
                      value={line.amount}
                      onChange={(e) => updateLine(idx, { amount: e.target.value })}
                      className="input tabular w-28"
                      aria-label={`Monto ${idx + 1}`}
                    />
                    {line.method !== 'CASH' && (
                      <select
                        value={line.provider ?? 'MOCK'}
                        onChange={(e) => updateLine(idx, { provider: e.target.value })}
                        className="input"
                        aria-label={`Proveedor ${idx + 1}`}
                      >
                        <option value="MOCK">Pago manual</option>
                      </select>
                    )}
                  </div>
                ))}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setLines((prev) => [...prev, { method: 'CARD', amount: '', provider: 'MOCK' }])}
                    className="btn btn-lg"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Pago mixto
                  </button>
                  <span className="tabular text-xs text-muted-foreground">
                    Suma: {formatMoney(lineSum, countryCode)}
                  </span>
                </div>

                {/* Propina: aparte del total, va al mozo. Antes el POS
                    rechazaba con 400 cualquier pago mayor al total. */}
                <div className="mt-3 border-t border-border pt-3">
                  <label className="label" htmlFor="pos-tip">
                    Propina <span className="font-normal text-muted-foreground">(opcional)</span>
                  </label>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {[10, 15].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setTip((Math.round((targetAmount() * pct) / 100)).toString())}
                        className="btn btn-sm"
                      >
                        {pct}%
                      </button>
                    ))}
                    <input
                      id="pos-tip"
                      type="number"
                      min={0}
                      value={tip}
                      onChange={(e) => setTip(e.target.value)}
                      placeholder="0"
                      className="input tabular w-28"
                    />
                    {Number(tip) > 0 && (
                      <button type="button" onClick={() => setTip('')} className="btn btn-ghost btn-sm">
                        Quitar
                      </button>
                    )}
                    <span className="tabular ml-auto text-sm font-medium">
                      A cobrar: {formatMoney(targetAmount() + (Number(tip) || 0), countryCode)}
                    </span>
                  </div>
                </div>

                {/* `disabled` mientras cobra: sin esto un doble click manda
                    dos cobros. La clave de idempotencia lo ataja igual en el
                    servidor, pero no hay que depender de una sola defensa. */}
                <button
                  onClick={onCharge}
                  disabled={charging}
                  className="btn btn-primary btn-lg mt-3 w-full font-semibold"
                >
                  {charging ? 'Cobrando...' : 'Cobrar'}
                </button>
              </div>

            </div>
          )}

          {/* ---- Post-cobro: comprobante y reembolso ----
              VA FUERA del bloque de `selectedOrder` a propósito. Al cobrar, el
              pedido pasa a COMPLETED y sale de `/pos/orders/pending`, así que
              `selectedOrder` queda null y todo esto se desmontaba al instante:
              en el flujo normal (efectivo) el cajero NUNCA llegaba a imprimir el
              ticket ni a reembolsar — el botón de reembolso era código muerto,
              porque `lastCharged` sólo se setea en la rama que lo desmontaba.
              Ahora depende de lo que quedó del cobro, no del pedido. */}
          {(invoice || chargeNotice || lastReceipt || refundNotice || lastCharged) && (
            <div className="panel mt-4 p-4">
              <h2 className="mb-2 font-heading font-medium">Última venta cobrada</h2>

              {invoice && (
                <Alert tone="ok" className="mt-3">
                  <p className="font-heading font-medium">Comprobante emitido</p>
                  <p className="tabular">
                    Serie {invoice.series} · N° {invoice.number} · Total{' '}
                    {formatMoney(invoice.totalAmount, countryCode)}
                  </p>
                </Alert>
              )}

              {chargeNotice && (
                <Alert tone="info" className="mt-3">
                  {chargeNotice}
                </Alert>
              )}

              {lastReceipt && (
                <button
                  onClick={() => printSalesReceipt(lastReceipt)}
                  className="btn btn-lg mt-3 w-full"
                  aria-label="Imprimir comprobante de venta"
                >
                  <Receipt className="h-4 w-4" />
                  Imprimir comprobante
                </button>
              )}

              {refundNotice && (
                <Alert tone="ok" className="mt-3">
                  {refundNotice}
                </Alert>
              )}

              {lastCharged && !refundOpen && (
                <button
                  onClick={() => {
                    setRefundOpen(true);
                    setRefundAmount(String(lastCharged.total));
                    setRefundReason('');
                  }}
                  className="btn btn-danger mt-3 w-full"
                >
                  <Undo2 className="h-4 w-4" />
                  Reembolsar esta venta
                </button>
              )}

              {lastCharged && refundOpen && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <div className="flex flex-wrap items-end gap-2">
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
                      Total {formatMoney(lastCharged.total, countryCode)} — dejalo así para total, o bajalo para parcial.
                    </span>
                  </div>
                  <input
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Motivo del reembolso"
                    maxLength={300}
                    aria-label="Motivo del reembolso"
                    className="input w-full"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={onRefund}
                      disabled={refundBusy || refundReason.trim().length < 3 || !(Number(refundAmount) > 0)}
                      className="btn btn-danger"
                    >
                      {refundBusy ? 'Reembolsando...' : 'Confirmar reembolso'}
                    </button>
                    <button onClick={() => setRefundOpen(false)} className="btn btn-ghost">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!selectedOrder && !lastCharged && (
            <EmptyState
              icon={Receipt}
              title="Ningún pedido seleccionado"
              description="Elegí un pedido de la lista para cobrarlo."
            />
          )}
        </div>
      </div>

      {/* Movimiento de caja — retiro (PAY_OUT) o ingreso (PAY_IN) manual con la
          caja abierta. El motivo es obligatorio en el retiro. */}
      {movementOpen && session && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={() => !movementSubmitting && setMovementOpen(false)}
          role="presentation"
        >
          <div
            className="panel max-h-[90vh] w-full max-w-md animate-slide-up overflow-y-auto rounded-b-none p-5 sm:rounded-b-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Movimiento de caja"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="font-heading text-xl font-semibold text-foreground">Movimiento de caja</h2>
              <button
                type="button"
                onClick={() => setMovementOpen(false)}
                disabled={movementSubmitting}
                className="btn btn-ghost btn-icon"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {movementError && (
              <Alert tone="error" className="mb-3">
                {movementError}
              </Alert>
            )}

            <div className="mb-3">
              <span className="label mb-1.5 block">Tipo de movimiento</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMovementType('PAY_IN')}
                  aria-pressed={movementType === 'PAY_IN'}
                  className={`btn btn-lg flex-1 ${movementType === 'PAY_IN' ? 'btn-primary' : ''}`}
                >
                  Ingreso
                </button>
                <button
                  type="button"
                  onClick={() => setMovementType('PAY_OUT')}
                  aria-pressed={movementType === 'PAY_OUT'}
                  className={`btn btn-lg flex-1 ${movementType === 'PAY_OUT' ? 'btn-primary' : ''}`}
                >
                  Retiro
                </button>
              </div>
            </div>

            <div className="mb-3">
              <label htmlFor="mov-amount" className="label mb-1.5">
                Monto
              </label>
              <input
                id="mov-amount"
                type="number"
                min={0}
                step="0.01"
                value={movementAmount}
                onChange={(e) => setMovementAmount(e.target.value)}
                placeholder="0"
                className="input tabular w-full"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="mov-note" className="label mb-1.5">
                Motivo{' '}
                {movementType === 'PAY_OUT' ? (
                  <span className="text-error">*</span>
                ) : (
                  <span className="font-normal text-muted-foreground">(opcional)</span>
                )}
              </label>
              <textarea
                id="mov-note"
                value={movementNote}
                onChange={(e) => setMovementNote(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder={movementType === 'PAY_OUT' ? 'Motivo del retiro (obligatorio)' : 'Nota (opcional)'}
                className="input w-full"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMovementOpen(false)}
                disabled={movementSubmitting}
                className="btn btn-lg flex-1"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSubmitMovement}
                disabled={
                  movementSubmitting ||
                  !movementAmount ||
                  Number(movementAmount) <= 0 ||
                  (movementType === 'PAY_OUT' && !movementNote.trim())
                }
                className="btn btn-primary btn-lg flex-1"
              >
                {movementSubmitting ? 'Registrando...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
