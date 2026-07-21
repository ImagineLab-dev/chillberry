import { formatMoney } from '@chillberry/domain';

/**
 * Impresión de tickets térmicos. Abre una ventana aislada (80mm) con el HTML del
 * ticket y dispara `print()`. Se hace en ventana aparte —no con `@media print`
 * sobre la página— para no arrastrar el layout de la app ni ensuciar el CSS
 * global, y para que salga con el ancho de papel correcto en la impresora.
 * Requiere gesto del usuario (click) para que el navegador no bloquee el popup.
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function printTicketHtml(title: string, innerHtml: string): void {
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) {
    alert('El navegador bloqueó la ventana de impresión. Habilitá los popups para imprimir tickets.');
    return;
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>` +
      `@page{size:80mm auto;margin:4mm}` +
      `*{box-sizing:border-box}` +
      `body{font-family:'Courier New',monospace;font-size:12px;color:#000;width:72mm;margin:0 auto;-webkit-print-color-adjust:exact}` +
      `h1{font-size:15px;text-align:center;margin:0 0 2px}` +
      `.center{text-align:center}.muted{color:#333}.big{font-size:14px;font-weight:bold}` +
      `.row{display:flex;justify-content:space-between;gap:8px}` +
      `.divider{border-top:1px dashed #000;margin:6px 0}` +
      `table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:1px 0}` +
      `.qty{width:28px}.amt{text-align:right;white-space:nowrap}` +
      `.note{font-size:11px;padding-left:28px;font-style:italic}` +
      `</style></head><body>${innerHtml}` +
      `<script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close()},300)}<\/script>` +
      `</body></html>`,
  );
  w.document.close();
}

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: 'Salón',
  TAKEAWAY: 'Para llevar',
  DELIVERY: 'Delivery',
};

// ------------------------------------------------------------- comanda cocina

export type KitchenTicketItem = {
  quantity: number;
  notes?: string | null;
  modifiers?: { groupName: string; optionName: string }[] | null;
  menuItem: { name: string };
};

export type KitchenTicketData = {
  station?: string;
  type: string;
  tableCode?: string | null;
  orderNotes?: string | null;
  items: KitchenTicketItem[];
  now: Date;
};

/** Comanda de cocina: SIN precios. Lo que el cocinero necesita — qué preparar,
 *  cuánto, con qué cambios, para qué mesa. */
export function printKitchenTicket(d: KitchenTicketData): void {
  const ref = d.tableCode ? `MESA ${escapeHtml(d.tableCode)}` : ORDER_TYPE_LABEL[d.type] ?? escapeHtml(d.type);
  const time = d.now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rows = d.items
    .map((it) => {
      const mods = (it.modifiers ?? []).map((m) => `<div class="note">+ ${escapeHtml(m.optionName)}</div>`).join('');
      const note = it.notes ? `<div class="note">↳ ${escapeHtml(it.notes)}</div>` : '';
      return (
        `<tr><td class="qty big">${it.quantity}×</td><td class="big">${escapeHtml(it.menuItem.name)}</td></tr>` +
        (mods || note ? `<tr><td></td><td>${mods}${note}</td></tr>` : '')
      );
    })
    .join('');
  const orderNote = d.orderNotes
    ? `<div class="divider"></div><div class="note" style="padding-left:0">Nota: ${escapeHtml(d.orderNotes)}</div>`
    : '';
  printTicketHtml(
    `Comanda ${ref}`,
    `<h1>COMANDA</h1>` +
      `<div class="center big">${ref}</div>` +
      (d.station ? `<div class="center muted">${escapeHtml(d.station)}</div>` : '') +
      `<div class="center muted">${time}</div>` +
      `<div class="divider"></div>` +
      `<table>${rows}</table>` +
      orderNote,
  );
}

// ------------------------------------------------------------ comprobante venta

export type SalesReceiptData = {
  branchName: string;
  countryCode: string;
  invoice?: { series: string; number: string } | null;
  tableCode?: string | null;
  type: string;
  items: { quantity: number; unitPrice: string | number; menuItem: { name: string } }[];
  subtotal?: number | null;
  taxTotal?: number | null;
  total: number;
  payments?: { method: string; amount: number }[];
  tip?: number | null;
  now: Date;
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  QR: 'QR',
  WALLET: 'Wallet',
};

/** Comprobante de venta para el cliente: items con precio, total, pago, propina. */
export function printSalesReceipt(d: SalesReceiptData): void {
  const money = (n: number) => formatMoney(n, d.countryCode);
  const ref = d.tableCode ? `Mesa ${escapeHtml(d.tableCode)}` : ORDER_TYPE_LABEL[d.type] ?? escapeHtml(d.type);
  const when = d.now.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  const rows = d.items
    .map(
      (it) =>
        `<tr><td class="qty">${it.quantity}×</td><td>${escapeHtml(it.menuItem.name)}</td>` +
        `<td class="amt">${money(Number(it.unitPrice) * it.quantity)}</td></tr>`,
    )
    .join('');
  const pays = (d.payments ?? [])
    .map((p) => `<div class="row"><span>${PAYMENT_LABEL[p.method] ?? escapeHtml(p.method)}</span><span>${money(p.amount)}</span></div>`)
    .join('');
  const invoiceLine = d.invoice
    ? `<div class="center muted">Comprobante ${escapeHtml(d.invoice.series)}-${escapeHtml(d.invoice.number)}</div>`
    : '';
  printTicketHtml(
    `Comprobante ${d.branchName}`,
    `<h1>${escapeHtml(d.branchName)}</h1>` +
      invoiceLine +
      `<div class="center muted">${when} · ${ref}</div>` +
      `<div class="divider"></div>` +
      `<table>${rows}</table>` +
      `<div class="divider"></div>` +
      (d.subtotal != null ? `<div class="row"><span>Subtotal</span><span>${money(d.subtotal)}</span></div>` : '') +
      (d.taxTotal != null && d.taxTotal > 0
        ? `<div class="row"><span>Impuestos</span><span>${money(d.taxTotal)}</span></div>`
        : '') +
      `<div class="row big"><span>TOTAL</span><span>${money(d.total)}</span></div>` +
      (pays ? `<div class="divider"></div>${pays}` : '') +
      (d.tip && d.tip > 0 ? `<div class="row"><span>Propina</span><span>${money(d.tip)}</span></div>` : '') +
      `<div class="divider"></div><div class="center muted">¡Gracias por tu visita!</div>`,
  );
}
