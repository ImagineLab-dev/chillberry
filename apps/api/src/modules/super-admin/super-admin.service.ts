import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canDowngradeToPlan, SUBSCRIPTION_STATUS, type PlanLimits } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { ChangeTenantPlanDto } from './dto/change-tenant-plan.dto';
import { UpdateTenantSubscriptionDto } from './dto/update-tenant-subscription.dto';
import { ListAuditDto } from './dto/list-audit.dto';
import {
  DEFAULT_PAGE_SIZE,
  RECENT_INVOICES_LIMIT,
  SIGNUP_MONTHS,
  SUPER_ADMIN_AUDIT_ACTION,
  SYSTEM_TENANT_SLUG,
  type SuperAdminAuditAction,
} from './super-admin.constants';

/**
 * El único service del sistema que lee a través de TODOS los tenants.
 *
 * Usa `PrismaService` CRUDO a propósito — `TenantPrismaService` no está
 * inyectado acá y no debe estarlo: su extension filtra por el tenantId de la
 * request (que para un super admin es el tenant sistema, vacío), así que todo
 * listado devolvería cero filas. Mismo patrón que `PublicMenuService` y
 * `BillingService.processWebhook`, que también corren fuera del scope de un
 * tenant.
 *
 * La contracara de saltear el extension es que acá NO hay red de seguridad
 * automática: la protección es que TODOS los endpoints del controller exigen
 * `@Roles(USER_ROLE.SuperAdmin)`, y que toda escritura queda auditada.
 */

/** Campos de Tenant que expone el panel. Explícito y no `include: {tenant: true}`
 *  — un select abierto filtraría a la UI cualquier columna que se agregue
 *  después sin que nadie lo decida. */
const TENANT_SELECT = {
  id: true,
  name: true,
  slug: true,
  countryCode: true,
  currency: true,
  timezone: true,
  active: true,
  createdAt: true,
} as const;

/** Todo listado/métrica del panel excluye el tenant sistema: es infraestructura
 *  de Smartia, no un cliente. Ver SYSTEM_TENANT_SLUG. */
const NOT_SYSTEM_TENANT = { slug: { not: SYSTEM_TENANT_SLUG } } as const;

type UsageCounts = { branches: number; users: number; orders: number };

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class SuperAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- tenants

  async listTenants(query: ListTenantsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const where: Prisma.TenantWhereInput = {
      ...NOT_SYSTEM_TENANT,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // Un tenant sin Subscription (los hay: se pueden crear por seed sin
      // pasar por /auth/register) simplemente no matchea ningún ?status.
      ...(query.status ? { subscription: { is: { status: query.status } } } : {}),
    };

    const [total, tenants] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        select: {
          ...TENANT_SELECT,
          subscription: { select: { status: true, trialEndsAt: true, renewalDate: true, plan: { select: { id: true, code: true, name: true, priceMonthly: true, currency: true } } } },
          // `users` es la única relación directa Tenant->X que sirve para
          // contar acá. `Branch`/`Order` llevan tenantId pero NO tienen
          // relación declarada hacia Tenant (cuelgan de Restaurant/Branch),
          // así que se cuentan aparte con groupBy.
          _count: { select: { users: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const usage = await this.usageForTenants(tenants.map((t) => t.id));

    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        countryCode: t.countryCode,
        currency: t.currency,
        active: t.active,
        createdAt: t.createdAt,
        subscription: t.subscription
          ? {
              status: t.subscription.status,
              trialEndsAt: t.subscription.trialEndsAt,
              renewalDate: t.subscription.renewalDate,
              plan: t.subscription.plan,
            }
          : null,
        usage: {
          branches: usage.get(t.id)?.branches ?? 0,
          users: t._count.users,
          orders: usage.get(t.id)?.orders ?? 0,
        },
      })),
    };
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, ...NOT_SYSTEM_TENANT },
      select: {
        ...TENANT_SELECT,
        subscription: {
          select: {
            id: true,
            status: true,
            trialEndsAt: true,
            renewalDate: true,
            pastDueSince: true,
            cancelledAt: true,
            createdAt: true,
            plan: { select: { id: true, code: true, name: true, priceMonthly: true, currency: true, limits: true } },
            pendingPlan: { select: { id: true, code: true, name: true } },
          },
        },
        restaurants: {
          select: {
            id: true,
            name: true,
            active: true,
            createdAt: true,
            branches: { select: { id: true, name: true, address: true, active: true }, orderBy: { createdAt: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { users: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');

    const [invoices, orderCount, branchCount] = await Promise.all([
      this.prisma.subscriptionInvoice.findMany({
        where: { tenantId: id },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          paidAt: true,
          createdAt: true,
          plan: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_INVOICES_LIMIT,
      }),
      this.prisma.order.count({ where: { tenantId: id } }),
      this.prisma.branch.count({ where: { tenantId: id } }),
    ]);

    return {
      ...tenant,
      usage: { branches: branchCount, users: tenant._count.users, orders: orderCount },
      invoices,
    };
  }

  /**
   * Cambio de plan a mano. Valida el uso actual contra los límites del plan
   * nuevo reusando `canDowngradeToPlan` de @chillberry/domain — la MISMA
   * función que usa `BillingService.changePlan`, no una copia.
   *
   * Dos diferencias deliberadas con el camino del tenant (`BillingService`):
   *
   * 1. Valida SIEMPRE, no solo cuando baja de precio. Billing condiciona el
   *    chequeo a `!isUpgrade` (precio menor), pero "más caro" no implica
   *    "límites más altos" — el catálogo es JSON libre, nada impide un plan
   *    caro con menos sucursales. Si el plan nuevo entra holgado, el chequeo
   *    no cuesta nada; si no entra, evita dejar al tenant fuera de su propio
   *    límite.
   * 2. Valida también `maxUsers`, no solo `maxBranches`. `PlanLimits` declara
   *    los dos y el panel muestra los dos; billing solo mira sucursales.
   *    `canDowngradeToPlan` es `current <= max` — sirve igual para usuarios
   *    (el nombre del parámetro quedó por el primer caso de uso).
   */
  async changePlan(tenantId: string, dto: ChangeTenantPlanDto, superAdminId: string) {
    await this.assertTenantExists(tenantId);

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || !plan.active) throw new NotFoundException('Plan no encontrado');

    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!sub) {
      throw new NotFoundException(
        'Este tenant no tiene una suscripción — no hay plan que cambiar. Se crea al registrarse por /auth/register.',
      );
    }
    if (sub.planId === plan.id) throw new BadRequestException('El tenant ya está en ese plan');

    const limits = plan.limits as unknown as PlanLimits;
    const [branchCount, userCount] = await Promise.all([
      this.prisma.branch.count({ where: { tenantId } }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    const exceeded: Array<{ resource: string; current: number; limit: number }> = [];
    if (!canDowngradeToPlan(branchCount, limits.maxBranches)) {
      exceeded.push({ resource: 'sucursales', current: branchCount, limit: limits.maxBranches });
    }
    if (!canDowngradeToPlan(userCount, limits.maxUsers)) {
      exceeded.push({ resource: 'usuarios', current: userCount, limit: limits.maxUsers });
    }
    if (exceeded.length > 0) {
      // 409 accionable (mismo `code` que usa BillingService, así el front
      // puede tratar los dos igual): dice exactamente qué recurso se pasa,
      // cuánto tiene y cuánto permite el plan.
      throw new ConflictException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `El plan "${plan.name}" no alcanza para el uso actual de este tenant: ${exceeded
          .map((e) => `${e.current} ${e.resource} (permite ${e.limit})`)
          .join(', ')}. Hay que dar de baja recursos antes de cambiar de plan.`,
        exceeded,
      });
    }

    // La actualización y su registro de auditoría van en la MISMA
    // transacción: si el log falla, el cambio de plan se revierte. Una
    // escritura de super admin sin rastro es exactamente lo que no puede
    // pasar.
    const [updated] = await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { id: sub.id },
        data: { planId: plan.id, pendingPlanId: null },
        include: { plan: true },
      }),
      this.auditCreate(superAdminId, SUPER_ADMIN_AUDIT_ACTION.ChangePlan, tenantId, {
        fromPlan: { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name },
        toPlan: { id: plan.id, code: plan.code, name: plan.name },
        usageAtChange: { branches: branchCount, users: userCount },
        reason: dto.reason ?? null,
      }),
    ]);

    return updated;
  }

  /**
   * Suspender / reactivar. No toca `cancelledAt` ni `pastDueSince`: son del
   * motor de billing (webhooks de DLocal), no de una decisión manual.
   */
  async updateSubscription(tenantId: string, dto: UpdateTenantSubscriptionDto, superAdminId: string) {
    await this.assertTenantExists(tenantId);

    const sub = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundException('Este tenant no tiene una suscripción');
    if (sub.status === dto.status) {
      throw new BadRequestException(`La suscripción ya está en estado ${dto.status}`);
    }

    const isSuspending = dto.status === SUBSCRIPTION_STATUS.Suspended;
    const action: SuperAdminAuditAction = isSuspending
      ? SUPER_ADMIN_AUDIT_ACTION.SuspendSubscription
      : SUPER_ADMIN_AUDIT_ACTION.ReactivateSubscription;

    const [updated] = await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: dto.status },
        include: { plan: true },
      }),
      this.auditCreate(superAdminId, action, tenantId, {
        // `previousStatus` es lo que hace reversible una suspensión: sin esto,
        // reactivar un tenant que estaba en TRIAL lo manda a ACTIVE y nadie
        // sabe que había un trial corriendo.
        previousStatus: sub.status,
        newStatus: dto.status,
        reason: dto.reason ?? null,
      }),
    ]);

    return updated;
  }

  // ------------------------------------------------------------- métricas

  /**
   * Métricas del SaaS. Todo sale de conteos reales — no hay estimaciones.
   *
   * MRR: se agrupa por `Plan.currency`, NO por `Tenant.currency`. Son cosas
   * distintas y mezclarlas da un número inventado: `Tenant.currency` es la
   * moneda con la que el restaurante opera (su menú, sus pedidos), mientras
   * que lo que Smartia le cobra está cotizado en `Plan.currency`. Hoy los
   * tres planes están en USD y hay tenants operando en PYG/MXN/ARS: sumar por
   * moneda del tenant reportaría "₲ 79" de un cliente que paga USD 79.
   * Devuelve una lista `[{currency, amount, tenants}]` y no un escalar,
   * porque el día que exista un plan cotizado en otra moneda, sumar los dos
   * en un solo número sería sumar peras con manzanas.
   */
  async getMetrics() {
    const start = new Date();
    start.setMonth(start.getMonth() - (SIGNUP_MONTHS - 1), 1);
    start.setHours(0, 0, 0, 0);

    const [totalTenants, byStatus, byPlanRaw, activeSubs, recentTenants, byCountry] = await Promise.all([
      this.prisma.tenant.count({ where: NOT_SYSTEM_TENANT }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        where: { tenant: NOT_SYSTEM_TENANT },
        _count: { _all: true },
      }),
      this.prisma.subscription.groupBy({
        by: ['planId'],
        where: { tenant: NOT_SYSTEM_TENANT },
        _count: { _all: true },
      }),
      this.prisma.subscription.findMany({
        where: { status: SUBSCRIPTION_STATUS.Active, tenant: NOT_SYSTEM_TENANT },
        select: { plan: { select: { priceMonthly: true, currency: true } } },
      }),
      this.prisma.tenant.findMany({
        where: { ...NOT_SYSTEM_TENANT, createdAt: { gte: start } },
        select: { createdAt: true },
      }),
      this.prisma.tenant.groupBy({
        by: ['countryCode'],
        where: NOT_SYSTEM_TENANT,
        _count: { _all: true },
      }),
    ]);

    const plans = await this.prisma.plan.findMany({
      where: { id: { in: byPlanRaw.map((p) => p.planId) } },
      select: { id: true, code: true, name: true, priceMonthly: true, currency: true },
    });
    const planById = new Map(plans.map((p) => [p.id, p]));

    const statusCounts: Record<string, number> = {};
    for (const row of byStatus) statusCounts[row.status] = row._count._all;
    const withSubscription = byStatus.reduce((sum, r) => sum + r._count._all, 0);

    // MRR agrupado por moneda del PLAN (ver doc del método).
    const mrrByCurrency = new Map<string, { amount: number; tenants: number }>();
    for (const sub of activeSubs) {
      const cur = sub.plan.currency;
      const acc = mrrByCurrency.get(cur) ?? { amount: 0, tenants: 0 };
      acc.amount += Number(sub.plan.priceMonthly);
      acc.tenants += 1;
      mrrByCurrency.set(cur, acc);
    }

    // Buckets de los últimos 6 meses, incluido el actual, con ceros para los
    // meses sin altas — un gráfico con meses faltantes miente sobre la forma
    // de la curva. Se bucketea con la hora local del server (no hay un
    // timezone del SaaS: cada tenant tiene el suyo).
    const signups: Array<{ month: string; count: number }> = [];
    const bucket = new Map<string, number>();
    for (let i = 0; i < SIGNUP_MONTHS; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      bucket.set(monthKey(d), 0);
    }
    for (const t of recentTenants) {
      const k = monthKey(t.createdAt);
      if (bucket.has(k)) bucket.set(k, (bucket.get(k) ?? 0) + 1);
    }
    for (const [month, count] of bucket) signups.push({ month, count });

    return {
      totalTenants,
      byStatus: {
        TRIAL: statusCounts[SUBSCRIPTION_STATUS.Trial] ?? 0,
        ACTIVE: statusCounts[SUBSCRIPTION_STATUS.Active] ?? 0,
        PAST_DUE: statusCounts[SUBSCRIPTION_STATUS.PastDue] ?? 0,
        CANCELLED: statusCounts[SUBSCRIPTION_STATUS.Cancelled] ?? 0,
        SUSPENDED: statusCounts[SUBSCRIPTION_STATUS.Suspended] ?? 0,
        // Hay tenants sin Subscription (creados por seed, sin pasar por
        // /auth/register). Se expone en vez de esconderse: si no, la suma de
        // los estados no da `totalTenants` y el panel parece roto.
        WITHOUT_SUBSCRIPTION: totalTenants - withSubscription,
      },
      byPlan: byPlanRaw
        .map((row) => {
          const plan = planById.get(row.planId);
          return {
            planId: row.planId,
            code: plan?.code ?? 'DESCONOCIDO',
            name: plan?.name ?? 'Plan desconocido',
            priceMonthly: plan?.priceMonthly ?? null,
            currency: plan?.currency ?? null,
            tenants: row._count._all,
          };
        })
        .sort((a, b) => b.tenants - a.tenants),
      mrr: [...mrrByCurrency.entries()]
        .map(([currency, v]) => ({ currency, amount: v.amount, tenants: v.tenants }))
        .sort((a, b) => b.amount - a.amount),
      signupsByMonth: signups,
      byCountry: byCountry
        .map((row) => ({ countryCode: row.countryCode, tenants: row._count._all }))
        .sort((a, b) => b.tenants - a.tenants),
    };
  }

  // ------------------------------------------------------------ auditoría

  async listAudit(query: ListAuditDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;

    const [total, logs] = await Promise.all([
      this.prisma.superAdminAuditLog.count(),
      this.prisma.superAdminAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // `superAdminId`/`targetTenantId` no tienen FK (ver schema.prisma), así
    // que el "join" se hace acá a mano. Dos queries fijas, no N+1.
    const [admins, tenants] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(logs.map((l) => l.superAdminId))] } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.tenant.findMany({
        where: { id: { in: [...new Set(logs.map((l) => l.targetTenantId))] } },
        select: { id: true, name: true, slug: true },
      }),
    ]);
    const adminById = new Map(admins.map((a) => [a.id, a]));
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: logs.map((log) => ({
        id: log.id,
        action: log.action,
        detail: log.detail,
        createdAt: log.createdAt,
        // El log sobrevive al borrado del usuario/tenant que referencia (no
        // hay FK a propósito), así que el nombre puede no resolver. Se
        // devuelve el id igual en vez de perder la fila.
        superAdmin: adminById.get(log.superAdminId) ?? { id: log.superAdminId, name: null, email: null },
        targetTenant: tenantById.get(log.targetTenantId) ?? { id: log.targetTenantId, name: null, slug: null },
      })),
    };
  }

  // ------------------------------------------------------------- helpers

  /** Cuenta sucursales y pedidos de varios tenants en 2 queries (no N+1). */
  private async usageForTenants(tenantIds: string[]): Promise<Map<string, UsageCounts>> {
    const result = new Map<string, UsageCounts>();
    if (tenantIds.length === 0) return result;

    const [branches, orders] = await Promise.all([
      this.prisma.branch.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
      this.prisma.order.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds } }, _count: { _all: true } }),
    ]);

    for (const id of tenantIds) result.set(id, { branches: 0, users: 0, orders: 0 });
    for (const row of branches) {
      const acc = result.get(row.tenantId);
      if (acc) acc.branches = row._count._all;
    }
    for (const row of orders) {
      const acc = result.get(row.tenantId);
      if (acc) acc.orders = row._count._all;
    }
    return result;
  }

  /** 404 si no existe o si es el tenant sistema — el panel no se administra
   *  a sí mismo. */
  private async assertTenantExists(id: string): Promise<void> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, ...NOT_SYSTEM_TENANT },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
  }

  /** Devuelve la operación SIN await — para meterla en un `$transaction([...])`
   *  junto a la escritura que audita. */
  private auditCreate(
    superAdminId: string,
    action: SuperAdminAuditAction,
    targetTenantId: string,
    detail: Prisma.InputJsonValue,
  ) {
    return this.prisma.superAdminAuditLog.create({
      data: { superAdminId, action, targetTenantId, detail },
    });
  }
}
