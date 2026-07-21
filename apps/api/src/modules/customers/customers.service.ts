import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';
import { MergeCustomersDto } from './dto/merge-customers.dto';

/**
 * Clientes (CRM). La base "viva" se deriva de los pedidos COMPLETED por
 * teléfono (visitas, gasto, última visita). Sobre eso se hace OVERLAY con el
 * modelo `Customer` editable a mano: corregir el nombre, agregar email/notas, o
 * dar de alta un cliente que todavía no pidió. La identidad es el teléfono.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async list(branchId?: string, search?: string) {
    const [orders, records] = await Promise.all([
      this.tenantPrisma.client.order.findMany({
        where: {
          status: 'COMPLETED',
          customerPhone: { not: null },
          ...(branchId ? { branchId } : {}),
        },
        select: { customerName: true, customerPhone: true, total: true, completedAt: true, createdAt: true },
      }),
      this.tenantPrisma.client.customer.findMany(),
    ]);

    type Row = {
      phone: string;
      name: string | null;
      email: string | null;
      notes: string | null;
      hasRecord: boolean;
      orders: number;
      totalSpent: number;
      firstVisit: Date | null;
      lastVisit: Date | null;
    };
    const byPhone = new Map<string, Row>();

    // 1) agregación derivada de pedidos
    for (const o of orders) {
      const phone = o.customerPhone!;
      const when = o.completedAt ?? o.createdAt;
      const row = byPhone.get(phone);
      if (!row) {
        byPhone.set(phone, {
          phone,
          name: o.customerName,
          email: null,
          notes: null,
          hasRecord: false,
          orders: 1,
          totalSpent: round(Number(o.total)),
          firstVisit: when,
          lastVisit: when,
        });
      } else {
        row.orders += 1;
        row.totalSpent = round(row.totalSpent + Number(o.total));
        if (row.firstVisit && when < row.firstVisit) row.firstVisit = when;
        if (row.lastVisit && when > row.lastVisit) {
          row.lastVisit = when;
          if (o.customerName) row.name = o.customerName;
        }
      }
    }

    // 2) overlay del CRM: el nombre/email/notas cargados a mano ganan; los
    //    clientes sin pedidos (walk-in cargado a mano) aparecen con 0 visitas.
    for (const c of records) {
      const row = byPhone.get(c.phone);
      if (row) {
        row.name = c.name;
        row.email = c.email;
        row.notes = c.notes;
        row.hasRecord = true;
      } else {
        byPhone.set(c.phone, {
          phone: c.phone,
          name: c.name,
          email: c.email,
          notes: c.notes,
          hasRecord: true,
          orders: 0,
          totalSpent: 0,
          firstVisit: null,
          lastVisit: null,
        });
      }
    }

    let rows = [...byPhone.values()].map((r) => ({
      ...r,
      avgTicket: r.orders > 0 ? round(r.totalSpent / r.orders) : 0,
    }));

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.phone.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q));
    }

    rows.sort((a, b) => b.totalSpent - a.totalSpent);

    return {
      total: rows.length,
      totalRevenue: round(rows.reduce((s, r) => s + r.totalSpent, 0)),
      customers: rows.slice(0, 200),
    };
  }

  /** Alta o edición manual — upsert por (tenant, teléfono). Sirve para cargar un
   *  walk-in o para corregir/enriquecer un cliente derivado de pedidos. */
  upsert(dto: UpsertCustomerDto) {
    const phone = dto.phone.trim();
    return this.tenantPrisma.client.customer.upsert({
      where: { tenantId_phone: { tenantId: this.tenantPrisma.tenantId, phone } },
      create: {
        tenantId: this.tenantPrisma.tenantId,
        phone,
        name: dto.name.trim(),
        email: dto.email?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
      update: {
        name: dto.name.trim(),
        email: dto.email?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  /** Borra la ficha (no los pedidos: el cliente vuelve a ser solo derivado). */
  async remove(phone: string) {
    const result = await this.tenantPrisma.client.customer.deleteMany({ where: { phone } });
    if (result.count === 0) throw new NotFoundException('Cliente no encontrado');
    return { ok: true };
  }

  /**
   * Fusiona dos clientes duplicados (distinto formato del mismo teléfono):
   * reasigna los pedidos del alias al canónico (así el gasto/visitas se
   * consolidan) y mueve la cuenta de puntos si el canónico no tiene una. Borra
   * la ficha del alias.
   */
  async merge(dto: MergeCustomersDto) {
    const canonical = dto.canonicalPhone.trim();
    const alias = dto.aliasPhone.trim();
    if (canonical === alias) throw new BadRequestException('No se puede fusionar un cliente consigo mismo');

    await this.tenantPrisma.client.order.updateMany({
      where: { customerPhone: alias },
      data: { customerPhone: canonical },
    });

    // Loyalty: mover la cuenta del alias al canónico solo si éste no tiene una
    // (si ambos tienen, se conserva la del canónico — fusionar puntos es un caso
    // raro y evitamos chocar contra el unique (tenant, phone)).
    const aliasAcc = await this.tenantPrisma.client.loyaltyAccount.findFirst({ where: { phone: alias } });
    if (aliasAcc) {
      const canonAcc = await this.tenantPrisma.client.loyaltyAccount.findFirst({ where: { phone: canonical } });
      if (!canonAcc) {
        await this.tenantPrisma.client.loyaltyAccount.updateMany({
          where: { id: aliasAcc.id },
          data: { phone: canonical },
        });
      }
    }

    await this.tenantPrisma.client.customer.deleteMany({ where: { phone: alias } });
    return { ok: true };
  }

  /** Historial de un cliente: sus pedidos cobrados, más recientes primero. */
  getOrders(phone: string) {
    return this.tenantPrisma.client.order.findMany({
      where: { customerPhone: phone, status: 'COMPLETED' },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        id: true,
        total: true,
        type: true,
        completedAt: true,
        createdAt: true,
        items: { select: { quantity: true, menuItem: { select: { name: true } } } },
      },
    });
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
