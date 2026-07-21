import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { NotificationsService } from '../integrations/notifications.service';

/**
 * Marketing / CRM. Segmenta la base de clientes (derivada de los pedidos
 * COMPLETED por teléfono, igual que CustomersService) por COMPORTAMIENTO —
 * frecuentes, inactivos (win-back), nuevos — y permite mandarles una campaña
 * por WhatsApp o exportarlos. Los segmentos se calculan al vuelo; no hay estado
 * que mantener.
 */

const FREQUENT_MIN_ORDERS = 3;
const INACTIVE_DAYS = 30;
const NEW_DAYS = 14;
const MS_DAY = 24 * 60 * 60 * 1000;

export type SegmentKey = 'frequent' | 'inactive' | 'new';

type CustomerRow = {
  phone: string;
  name: string | null;
  orders: number;
  totalSpent: number;
  firstVisit: Date | null;
  lastVisit: Date | null;
};

@Injectable()
export class MarketingService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Los 3 segmentos con su conteo actual. */
  async segments() {
    const rows = await this.aggregate();
    return [
      {
        key: 'frequent' as const,
        label: 'Clientes frecuentes',
        description: `Con ${FREQUENT_MIN_ORDERS} o más pedidos — tus mejores clientes.`,
        count: rows.filter((r) => this.inSegment(r, 'frequent')).length,
      },
      {
        key: 'inactive' as const,
        label: 'Inactivos (win-back)',
        description: `Pidieron alguna vez pero no en los últimos ${INACTIVE_DAYS} días.`,
        count: rows.filter((r) => this.inSegment(r, 'inactive')).length,
      },
      {
        key: 'new' as const,
        label: 'Clientes nuevos',
        description: `Su primer pedido fue en los últimos ${NEW_DAYS} días.`,
        count: rows.filter((r) => this.inSegment(r, 'new')).length,
      },
    ];
  }

  /** Los clientes de un segmento (nombre, teléfono, pedidos, gasto, última visita). */
  async segmentCustomers(key: SegmentKey) {
    const rows = await this.aggregate();
    return rows
      .filter((r) => this.inSegment(r, key))
      .sort((a, b) => b.orders - a.orders)
      .map((r) => ({
        phone: r.phone,
        name: r.name,
        orders: r.orders,
        totalSpent: r.totalSpent,
        lastVisit: r.lastVisit,
      }));
  }

  /**
   * Manda una campaña por WhatsApp a todos los clientes del segmento con
   * teléfono. Best-effort (un envío caído no rompe el resto). Registra la
   * campaña para tener historial y devuelve a cuántos se mandó.
   */
  async sendCampaign(key: SegmentKey, message: string, userId: string) {
    const text = message.trim();
    if (text.length < 3) throw new BadRequestException('El mensaje de la campaña es muy corto');
    const customers = await this.segmentCustomers(key);
    const recipients = customers.filter((c) => c.phone);

    for (const c of recipients) {
      await this.notifications.notifyMarketingCampaign(c.phone, text).catch(() => {});
    }

    await this.tenantPrisma.client.marketingCampaign.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        segment: key,
        message: text,
        recipientCount: recipients.length,
        createdById: userId,
      },
    });

    return { ok: true, sent: recipients.length };
  }

  /** Historial de campañas enviadas (más recientes primero). */
  listCampaigns() {
    return this.tenantPrisma.client.marketingCampaign.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  }

  // ----------------------------------------------------------------- helpers

  private inSegment(r: CustomerRow, key: SegmentKey): boolean {
    const now = Date.now();
    switch (key) {
      case 'frequent':
        return r.orders >= FREQUENT_MIN_ORDERS;
      case 'inactive':
        return r.orders >= 1 && !!r.lastVisit && now - r.lastVisit.getTime() > INACTIVE_DAYS * MS_DAY;
      case 'new':
        return r.orders >= 1 && !!r.firstVisit && now - r.firstVisit.getTime() <= NEW_DAYS * MS_DAY;
    }
  }

  /** Agrega la base por teléfono (mismo criterio que CustomersService.list). */
  private async aggregate(): Promise<CustomerRow[]> {
    const [orders, records] = await Promise.all([
      this.tenantPrisma.client.order.findMany({
        where: { status: 'COMPLETED', customerPhone: { not: null } },
        select: { customerName: true, customerPhone: true, total: true, completedAt: true, createdAt: true },
      }),
      this.tenantPrisma.client.customer.findMany({ select: { phone: true, name: true } }),
    ]);

    const byPhone = new Map<string, CustomerRow>();
    for (const o of orders) {
      const phone = o.customerPhone!;
      const when = o.completedAt ?? o.createdAt;
      const row = byPhone.get(phone);
      if (!row) {
        byPhone.set(phone, {
          phone,
          name: o.customerName,
          orders: 1,
          totalSpent: Number(o.total),
          firstVisit: when,
          lastVisit: when,
        });
      } else {
        row.orders += 1;
        row.totalSpent += Number(o.total);
        if (row.firstVisit && when < row.firstVisit) row.firstVisit = when;
        if (row.lastVisit && when > row.lastVisit) {
          row.lastVisit = when;
          if (o.customerName) row.name = o.customerName;
        }
      }
    }
    // El nombre cargado a mano (CRM) gana sobre el derivado del pedido.
    for (const c of records) {
      const row = byPhone.get(c.phone);
      if (row) row.name = c.name;
    }
    return [...byPhone.values()].map((r) => ({ ...r, totalSpent: Math.round(r.totalSpent * 100) / 100 }));
  }
}
