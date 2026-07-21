import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { zonedDayKey, zonedHour } from '../../common/util/timezone';

/**
 * Reportes de ventas para el dueño. Es el "por qué pago el mes": no solo
 * cargar pedidos, sino saber qué se vende, cuándo y cuánto entra de verdad.
 *
 * Todo se calcula sobre pedidos COMPLETED (los efectivamente cobrados) y sus
 * pagos APPROVED — un pedido cancelado o a medio cobrar no es una venta.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  // `branchId` opcional: sin él, el reporte es CONSOLIDADO de todas las
  // sucursales del tenant (con desglose `byBranch`). Con él, sólo esa sucursal.
  async sales(branchId: string | undefined, from?: string, to?: string) {
    const completedAt: { gte?: Date; lte?: Date } = {};
    if (from) completedAt.gte = new Date(from);
    if (to) completedAt.lte = new Date(to);
    const dateFilter = from || to ? { completedAt } : {};
    // El filtro de sucursal se aplica sólo si vino; sino, todas (consolidado).
    const branchFilter = branchId ? { branchId } : {};

    // La curva diaria y la hora pico se bucketean en el huso del tenant, no en
    // el del servidor: sin esto, para un tenant en otro huso "hoy" y el pico se
    // corrían varias horas (una venta de las 23:30 local caía en el día UTC
    // siguiente). El timezone es un campo de config del tenant.
    const tenant = await this.tenantPrisma.client.tenant.findUniqueOrThrow({
      where: { id: this.tenantPrisma.tenantId },
      select: { timezone: true },
    });
    const tz = tenant.timezone;

    const orders = await this.tenantPrisma.client.order.findMany({
      where: { ...branchFilter, status: 'COMPLETED', ...dateFilter },
      select: {
        id: true,
        total: true,
        completedAt: true,
        waiterId: true,
        branchId: true,
        items: {
          select: { quantity: true, unitPrice: true, menuItem: { select: { name: true, cost: true } } },
        },
      },
    });

    // Los reembolsos se descuentan de la facturación. Antes no: `refundOrder`
    // devuelve la plata y marca los `Payment` como REFUNDED, pero no toca
    // `Order.status` ni `Order.total`, así que un pedido reembolsado entero
    // seguía contando como venta del día, en el ticket promedio, en el ranking
    // por mozo y en el margen. El arqueo de caja sí lo restaba: dos fuentes de
    // verdad, y la que mira el dueño era la inflada.
    const refundRows =
      orders.length > 0
        ? await this.tenantPrisma.client.cashMovement.groupBy({
            by: ['orderId'],
            where: { type: 'REFUND', orderId: { in: orders.map((o) => o.id) } },
            _sum: { amount: true },
          })
        : [];
    const refundByOrder = new Map(refundRows.map((r) => [r.orderId, Number(r._sum.amount ?? 0)]));

    // `net` = lo que de verdad quedó de ese pedido. El reembolsado por completo
    // deja de ser una venta y sale de TODOS los agregados (conteo, ticket
    // promedio, productos, mozo). Los parcialmente reembolsados siguen contando
    // como venta por su neto: la comida salió, sólo volvió parte de la plata.
    const sales = orders
      .map((o) => ({ ...o, net: round(Number(o.total) - (refundByOrder.get(o.id) ?? 0)) }))
      .filter((o) => o.net > 0.009);
    const refundedTotal = round(
      orders.reduce((s, o) => s + Math.min(refundByOrder.get(o.id) ?? 0, Number(o.total)), 0),
    );

    const revenue = round(sales.reduce((s, o) => s + o.net, 0));
    const itemsSold = sales.reduce((s, o) => s + o.items.reduce((n, i) => n + i.quantity, 0), 0);
    const avgTicket = sales.length > 0 ? round(revenue / sales.length) : 0;

    // Ventas por día (para la curva) — clave YYYY-MM-DD.
    const byDayMap = new Map<string, { revenue: number; orders: number }>();
    // Ventas por hora del día (para ver los picos) — 0..23.
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, orders: 0 }));

    for (const o of sales) {
      const when = o.completedAt ?? new Date();
      const dayKey = zonedDayKey(when, tz);
      const day = byDayMap.get(dayKey) ?? { revenue: 0, orders: 0 };
      day.revenue = round(day.revenue + o.net);
      day.orders += 1;
      byDayMap.set(dayKey, day);

      const h = zonedHour(when, tz);
      byHour[h]!.revenue = round(byHour[h]!.revenue + o.net);
      byHour[h]!.orders += 1;
    }
    const byDay = [...byDayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Productos más vendidos: por CANTIDAD y por FACTURACIÓN. El dueño necesita
    // los dos — el más vendido no siempre es el que más plata deja. Y con el
    // costo cargado, también el MARGEN: lo que de verdad gana.
    const productMap = new Map<
      string,
      { name: string; quantity: number; revenue: number; cost: number; allHaveCost: boolean }
    >();
    for (const o of sales) {
      for (const it of o.items) {
        const name = it.menuItem.name;
        const row = productMap.get(name) ?? { name, quantity: 0, revenue: 0, cost: 0, allHaveCost: true };
        row.quantity += it.quantity;
        row.revenue = round(row.revenue + Number(it.unitPrice) * it.quantity);
        if (it.menuItem.cost !== null) {
          row.cost = round(row.cost + Number(it.menuItem.cost) * it.quantity);
        } else {
          // Basta una línea sin costo para que el margen del producto sea
          // incalculable — reportarlo parcial mostraría un margen inflado.
          row.allHaveCost = false;
        }
        productMap.set(name, row);
      }
    }
    const products = [...productMap.values()].map((p) => ({
      name: p.name,
      quantity: p.quantity,
      revenue: p.revenue,
      // `null` si falta el costo de alguna línea: dato incompleto, no engañoso.
      margin: p.allHaveCost ? round(p.revenue - p.cost) : null,
    }));
    const topByRevenue = [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    const topByQuantity = [...products].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
    // Rentabilidad: solo los que tienen margen calculable, de mayor a menor.
    const withMargin = products.filter((p): p is typeof p & { margin: number } => p.margin !== null);
    const topByMargin = [...withMargin].sort((a, b) => b.margin - a.margin).slice(0, 10);
    const totalMargin = round(withMargin.reduce((s, p) => s + p.margin, 0));
    const productsWithoutCost = products.filter((p) => p.margin === null).length;

    // Ventas por medio de pago (sobre los pagos aprobados de esos pedidos).
    const orderIds = sales.map((o) => o.id);
    const payments =
      orderIds.length > 0
        ? await this.tenantPrisma.client.payment.groupBy({
            by: ['method'],
            where: { orderId: { in: orderIds }, status: 'APPROVED' },
            _sum: { amount: true },
            _count: true,
          })
        : [];
    const byPaymentMethod = payments.map((p) => ({
      method: p.method,
      amount: round(Number(p._sum.amount ?? 0)),
      count: p._count,
    }));

    // ---- Ventas por MOZO (no sólo propinas): quién factura más en el rango. ----
    const waiterAgg = new Map<string | null, { orders: number; revenue: number }>();
    for (const o of sales) {
      const key = o.waiterId ?? null;
      const row = waiterAgg.get(key) ?? { orders: 0, revenue: 0 };
      row.orders += 1;
      row.revenue = round(row.revenue + o.net);
      waiterAgg.set(key, row);
    }
    const waiterIds = [...waiterAgg.keys()].filter((k): k is string => k !== null);
    const waiterUsers =
      waiterIds.length > 0
        ? await this.tenantPrisma.client.user.findMany({
            where: { id: { in: waiterIds } },
            select: { id: true, name: true },
          })
        : [];
    const waiterNameById = new Map(waiterUsers.map((u) => [u.id, u.name]));
    const byWaiter = [...waiterAgg.entries()]
      .map(([waiterId, v]) => ({
        waiterId,
        // null = pedidos self-service por QR (sin mozo asignado).
        waiterName: waiterId ? (waiterNameById.get(waiterId) ?? 'Mozo eliminado') : 'Sin asignar (QR)',
        orders: v.orders,
        revenue: v.revenue,
        avgTicket: v.orders > 0 ? round(v.revenue / v.orders) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // ---- Consolidado multi-sucursal: desglose por sucursal. Sólo cuando NO se
    // filtró una sucursal puntual (reporte consolidado). ----
    let byBranch: { branchId: string; branchName: string; orders: number; revenue: number }[] | undefined;
    if (!branchId) {
      const branchAgg = new Map<string, { orders: number; revenue: number }>();
      for (const o of sales) {
        const row = branchAgg.get(o.branchId) ?? { orders: 0, revenue: 0 };
        row.orders += 1;
        row.revenue = round(row.revenue + o.net);
        branchAgg.set(o.branchId, row);
      }
      const branchIds = [...branchAgg.keys()];
      const branchRows =
        branchIds.length > 0
          ? await this.tenantPrisma.client.branch.findMany({
              where: { id: { in: branchIds } },
              select: { id: true, name: true },
            })
          : [];
      const branchNameById = new Map(branchRows.map((b) => [b.id, b.name]));
      byBranch = [...branchAgg.entries()]
        .map(([bid, v]) => ({
          branchId: bid,
          branchName: branchNameById.get(bid) ?? '—',
          orders: v.orders,
          revenue: v.revenue,
        }))
        .sort((a, b) => b.revenue - a.revenue);
    }

    // ---- Comparación de período: misma ventana de tiempo JUSTO ANTES. Sólo con
    // un rango acotado (from + to), sino no hay "período anterior" definido. ----
    let comparison:
      | { previousRevenue: number; previousOrders: number; revenueDeltaPct: number | null; ordersDeltaPct: number | null }
      | undefined;
    if (from && to) {
      const fromMs = new Date(from).getTime();
      const durationMs = new Date(to).getTime() - fromMs;
      const prevTo = new Date(fromMs - 1);
      const prevFrom = new Date(fromMs - durationMs - 1);
      const prevOrders = await this.tenantPrisma.client.order.findMany({
        where: { ...branchFilter, status: 'COMPLETED', completedAt: { gte: prevFrom, lte: prevTo } },
        select: { total: true },
      });
      const previousRevenue = round(prevOrders.reduce((s, o) => s + Number(o.total), 0));
      const previousOrders = prevOrders.length;
      comparison = {
        previousRevenue,
        previousOrders,
        revenueDeltaPct:
          previousRevenue > 0 ? Math.round(((revenue - previousRevenue) / previousRevenue) * 100) : null,
        ordersDeltaPct:
          previousOrders > 0 ? Math.round(((sales.length - previousOrders) / previousOrders) * 100) : null,
      };
    }

    return {
      summary: {
        orders: sales.length,
        revenue,
        avgTicket,
        itemsSold,
        // Margen total del rango (solo productos con costo cargado).
        margin: totalMargin,
        productsWithoutCost,
        // Lo devuelto en el rango, para que el dueño vea por qué la facturación
        // no coincide con la suma cruda de los pedidos.
        refunded: refundedTotal,
      },
      byDay,
      byHour,
      byPaymentMethod,
      byWaiter,
      byBranch,
      comparison,
      topByRevenue,
      topByQuantity,
      topByMargin,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
