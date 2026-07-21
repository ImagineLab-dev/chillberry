import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { BillingService } from '../billing/billing.service';
import { startOfDayInTz, startOfNextDayInTz, zonedDayKey } from '../../common/util/timezone';

const ACTIVE_DELIVERY_STATUSES = ['PENDING', 'DRIVER_ASSIGNED', 'ACCEPTED', 'PICKED_UP'] as const;

@Injectable()
export class DashboardService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly billing: BillingService,
  ) {}

  async getSummary() {
    // El "hoy" del dashboard se corta en el huso del tenant, no en el del
    // servidor: sin esto un tenant en otro huso veía la venta/pedidos de hoy
    // desfasados varias horas (o el día equivocado cerca de medianoche).
    const tenant = await this.tenantPrisma.client.tenant.findUniqueOrThrow({
      where: { id: this.tenantPrisma.tenantId },
      select: { timezone: true },
    });
    const tz = tenant.timezone;
    const since = startOfDayInTz(tz);
    const tomorrow = startOfNextDayInTz(tz);
    // Comienzo del día local de hace 6 días → ventana de 7 días (hoy incluido)
    // para la mini-tendencia de ingresos.
    const weekStart = startOfDayInTz(tz, new Date(since.getTime() - 6 * MS_PER_DAY));

    const [
      todayOrders,
      todayCompletedOrders,
      tablesByStatus,
      pendingDeliveries,
      todayReservations,
      subscription,
      unassignedDeliveries,
      lowStockCandidates,
      staleCashSessions,
      weekOrders,
    ] = await Promise.all([
      this.tenantPrisma.client.order.count({ where: { createdAt: { gte: since } } }),
      this.tenantPrisma.client.order.findMany({
        where: { status: 'COMPLETED', completedAt: { gte: since } },
        select: { id: true, total: true },
      }),
      this.tenantPrisma.client.table.groupBy({ by: ['status'], _count: true }),
      this.tenantPrisma.client.delivery.count({ where: { status: { in: [...ACTIVE_DELIVERY_STATUSES] } } }),
      // Reservas activas de HOY (las que todavía no se sentaron ni cancelaron).
      // El dashboard mostraba `table.status === RESERVED`, que nada setea → 0
      // siempre. Este es el número real que sale del sistema de reservas.
      this.tenantPrisma.client.reservation.count({
        where: {
          status: { in: ['PENDING', 'CONFIRMED'] },
          reservedFor: { gte: since, lt: tomorrow },
        },
      }),
      this.billing.getMySubscription(),
      // ---- Alertas operativas ----
      // Delivery SIN repartidor (PENDING) — necesita asignación manual ya.
      this.tenantPrisma.client.delivery.count({ where: { status: 'PENDING' } }),
      // Insumos con umbral de alerta cargado; el "stock <= umbral" se filtra en
      // JS (Prisma no compara dos columnas en un where simple, y son pocos).
      this.tenantPrisma.client.ingredient.findMany({
        where: { active: true, lowStockAt: { not: null } },
        select: { id: true, name: true, unit: true, stockQty: true, lowStockAt: true },
      }),
      // Cajas abiertas de un día ANTERIOR (alguien no cerró la caja) — una caja
      // abierta hoy es normal, una de ayer es el problema.
      this.tenantPrisma.client.cashRegisterSession.count({
        where: { status: 'OPEN', openedAt: { lt: since } },
      }),
      // Ingresos de los últimos 7 días para la mini-tendencia.
      this.tenantPrisma.client.order.findMany({
        where: { status: 'COMPLETED', completedAt: { gte: weekStart } },
        select: { id: true, total: true, completedAt: true },
      }),
    ]);

    // Neto de reembolsos, igual que en Reportes: `refundOrder` devuelve la plata
    // pero no toca `Order.total`, así que sin esto un pedido reembolsado seguía
    // sumando a los ingresos del día y a la curva de la semana.
    const refundRows =
      weekOrders.length > 0
        ? await this.tenantPrisma.client.cashMovement.groupBy({
            by: ['orderId'],
            where: { type: 'REFUND', orderId: { in: weekOrders.map((o) => o.id) } },
            _sum: { amount: true },
          })
        : [];
    const refundByOrder = new Map(refundRows.map((r) => [r.orderId, Number(r._sum.amount ?? 0)]));
    const netTotal = (o: { id: string; total: unknown }) =>
      Math.max(0, Number(o.total) - (refundByOrder.get(o.id) ?? 0));

    const todayRevenue = todayCompletedOrders.reduce((sum, o) => sum + netTotal(o), 0);
    const tableCounts = { AVAILABLE: 0, OCCUPIED: 0, RESERVED: 0 };
    for (const row of tablesByStatus) {
      tableCounts[row.status as keyof typeof tableCounts] = row._count;
    }
    const totalTables = tableCounts.AVAILABLE + tableCounts.OCCUPIED + tableCounts.RESERVED;

    // Insumos bajo umbral (stock <= lowStockAt). Orden: los más críticos primero
    // (menor ratio stock/umbral), y sólo mando los primeros para la UI.
    const lowStock = lowStockCandidates
      .filter((i) => i.lowStockAt !== null && Number(i.stockQty) <= Number(i.lowStockAt))
      .map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        stockQty: Number(i.stockQty),
        lowStockAt: Number(i.lowStockAt),
      }))
      .sort((a, b) => a.stockQty / (a.lowStockAt || 1) - b.stockQty / (b.lowStockAt || 1));

    // Mini-tendencia: 7 claves de día locales (viejo→hoy), cada una con su total.
    const revByDay = new Map<string, number>();
    for (const o of weekOrders) {
      const key = zonedDayKey(o.completedAt ?? new Date(), tz);
      revByDay.set(key, (revByDay.get(key) ?? 0) + netTotal(o));
    }
    const last7Days: { date: string; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      // Mediodía local del día -i para sacar su clave sin riesgo de borde.
      const key = zonedDayKey(new Date(since.getTime() - i * MS_PER_DAY + 12 * 60 * 60 * 1000), tz);
      last7Days.push({ date: key, revenue: Math.round((revByDay.get(key) ?? 0) * 100) / 100 });
    }
    // Ayer = anteúltimo de la ventana (para el delta "hoy vs ayer").
    const yesterdayRevenue = last7Days[5]?.revenue ?? 0;

    return {
      todayOrders,
      todayRevenue,
      yesterdayRevenue,
      last7Days,
      tables: { ...tableCounts, total: totalTables },
      todayReservations,
      pendingDeliveries,
      alerts: {
        unassignedDeliveries,
        staleCashSessions,
        lowStock: { count: lowStock.length, items: lowStock.slice(0, 5) },
      },
      subscription: {
        status: subscription.status,
        plan: subscription.plan.name,
        planCode: subscription.plan.code,
        usage: subscription.usage,
      },
    };
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
