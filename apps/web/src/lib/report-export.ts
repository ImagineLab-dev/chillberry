import { formatMoney } from '@chillberry/domain';

/**
 * Exportación del reporte de ventas. Dos salidas:
 *  - CSV: números crudos para que el contador los abra en la planilla.
 *  - PDF: se arma una ventana imprimible A4 y el navegador ofrece "Guardar como
 *    PDF" — así no metemos una dependencia de generación de PDF en el bundle.
 */

type Summary = {
  orders: number;
  revenue: number;
  avgTicket: number;
  itemsSold: number;
  margin: number;
  productsWithoutCost: number;
};
type ProductRow = { name: string; quantity: number; revenue: number; margin: number | null };
export type SalesReportExport = {
  summary: Summary;
  byDay: { date: string; revenue: number; orders: number }[];
  byPaymentMethod: { method: string; amount: number; count: number }[];
  topByRevenue: ProductRow[];
  topByQuantity: ProductRow[];
  topByMargin: { name: string; quantity: number; revenue: number; margin: number }[];
};
export type TipsReportExport = {
  total: number;
  byWaiter: { waiterName: string; total: number; count: number }[];
};
export type ReportMeta = { branchName: string; from: string; to: string; countryCode: string };

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  QR: 'QR',
  WALLET: 'Billetera',
};

function rangeLabel(meta: ReportMeta): string {
  if (meta.from && meta.to) return `${meta.from} a ${meta.to}`;
  if (meta.from) return `desde ${meta.from}`;
  return 'todo el histórico';
}

// ------------------------------------------------------------------- CSV

function csvCell(v: string | number): string {
  let s = String(v);
  // Anti-inyección de fórmulas: una celda que arranca con = + - @ (o tab/CR) es
  // ejecutada por Excel/Sheets. Un nombre de producto "=HYPERLINK(...)" podría
  // exfiltrar datos al abrir el CSV. Prefijamos con comilla simple para
  // neutralizarla (queda como texto).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(',');
}

export function downloadReportCsv(report: SalesReportExport, tips: TipsReportExport | null, meta: ReportMeta): void {
  const s = report.summary;
  const lines: string[] = [];
  lines.push(csvRow(['Reporte de ventas', meta.branchName, rangeLabel(meta)]));
  lines.push('');
  lines.push(csvRow(['Resumen']));
  lines.push(csvRow(['Ingresos', s.revenue]));
  lines.push(csvRow(['Pedidos', s.orders]));
  lines.push(csvRow(['Ticket promedio', s.avgTicket]));
  lines.push(csvRow(['Ítems vendidos', s.itemsSold]));
  lines.push(csvRow(['Margen', s.margin]));
  lines.push('');
  lines.push(csvRow(['Ventas por día']));
  lines.push(csvRow(['Fecha', 'Ingresos', 'Pedidos']));
  report.byDay.forEach((d) => lines.push(csvRow([d.date, d.revenue, d.orders])));
  lines.push('');
  lines.push(csvRow(['Medios de pago']));
  lines.push(csvRow(['Medio', 'Monto', 'Operaciones']));
  report.byPaymentMethod.forEach((p) => lines.push(csvRow([PAYMENT_LABEL[p.method] ?? p.method, p.amount, p.count])));
  lines.push('');
  lines.push(csvRow(['Top productos por ingreso']));
  lines.push(csvRow(['Producto', 'Cantidad', 'Ingreso', 'Margen']));
  report.topByRevenue.forEach((p) => lines.push(csvRow([p.name, p.quantity, p.revenue, p.margin ?? ''])));
  if (tips && tips.byWaiter.length > 0) {
    lines.push('');
    lines.push(csvRow(['Propinas por mozo']));
    lines.push(csvRow(['Mozo', 'Total', 'Pedidos']));
    tips.byWaiter.forEach((w) => lines.push(csvRow([w.waiterName, w.total, w.count])));
    lines.push(csvRow(['Total propinas', tips.total]));
  }

  // BOM para que Excel abra el UTF-8 con acentos correctamente.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, `reporte-ventas-${meta.from || 'historico'}.csv`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------- PDF (print)

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function printReportPdf(report: SalesReportExport, tips: TipsReportExport | null, meta: ReportMeta): void {
  const money = (n: number) => formatMoney(n, meta.countryCode);
  const s = report.summary;
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) {
    alert('El navegador bloqueó la ventana. Habilitá los popups para generar el PDF.');
    return;
  }
  const dayRows = report.byDay.map((d) => `<tr><td>${esc(d.date)}</td><td class="n">${money(d.revenue)}</td><td class="n">${d.orders}</td></tr>`).join('');
  const prodRows = report.topByRevenue
    .map((p) => `<tr><td>${esc(p.name)}</td><td class="n">${p.quantity}</td><td class="n">${money(p.revenue)}</td><td class="n">${p.margin != null ? money(p.margin) : '—'}</td></tr>`)
    .join('');
  const payRows = report.byPaymentMethod
    .map((p) => `<tr><td>${esc(PAYMENT_LABEL[p.method] ?? p.method)}</td><td class="n">${money(p.amount)}</td><td class="n">${p.count}</td></tr>`)
    .join('');
  const tipRows =
    tips && tips.byWaiter.length > 0
      ? `<h2>Propinas por mozo</h2><table><thead><tr><th>Mozo</th><th class="n">Total</th><th class="n">Pedidos</th></tr></thead><tbody>` +
        tips.byWaiter.map((t) => `<tr><td>${esc(t.waiterName)}</td><td class="n">${money(t.total)}</td><td class="n">${t.count}</td></tr>`).join('') +
        `</tbody></table>`
      : '';

  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Reporte de ventas — ${esc(meta.branchName)}</title><style>` +
      `@page{size:A4;margin:14mm}` +
      `*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Arial,sans-serif;color:#111;font-size:12px;margin:0}` +
      `h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #111;padding-bottom:2px}` +
      `.muted{color:#555}.cards{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}` +
      `.card{border:1px solid #ccc;border-radius:8px;padding:8px 12px;min-width:120px}` +
      `.card .k{color:#555;font-size:11px}.card .v{font-size:16px;font-weight:700}` +
      `table{width:100%;border-collapse:collapse;margin-top:4px}th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #e5e5e5}` +
      `th{background:#f3f3f3;font-size:11px;text-transform:uppercase;letter-spacing:.03em}.n{text-align:right;white-space:nowrap}` +
      `</style></head><body>` +
      `<h1>Reporte de ventas</h1>` +
      `<div class="muted">${esc(meta.branchName)} · ${esc(rangeLabel(meta))}</div>` +
      `<div class="cards">` +
      `<div class="card"><div class="k">Ingresos</div><div class="v">${money(s.revenue)}</div></div>` +
      `<div class="card"><div class="k">Pedidos</div><div class="v">${s.orders}</div></div>` +
      `<div class="card"><div class="k">Ticket prom.</div><div class="v">${money(s.avgTicket)}</div></div>` +
      `<div class="card"><div class="k">Margen</div><div class="v">${money(s.margin)}</div></div>` +
      `</div>` +
      `<h2>Ventas por día</h2><table><thead><tr><th>Fecha</th><th class="n">Ingresos</th><th class="n">Pedidos</th></tr></thead><tbody>${dayRows}</tbody></table>` +
      `<h2>Medios de pago</h2><table><thead><tr><th>Medio</th><th class="n">Monto</th><th class="n">Operaciones</th></tr></thead><tbody>${payRows}</tbody></table>` +
      `<h2>Top productos por ingreso</h2><table><thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Ingreso</th><th class="n">Margen</th></tr></thead><tbody>${prodRows}</tbody></table>` +
      tipRows +
      `<script>window.onload=function(){window.focus();window.print()}<\/script>` +
      `</body></html>`,
  );
  w.document.close();
}
