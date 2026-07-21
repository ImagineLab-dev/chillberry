import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canCreateBranch,
  canDowngradeToPlan,
  type PlanFeatures,
  type PlanLimits,
  type SubscriptionProviderAdapter,
} from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { SUBSCRIPTION_PROVIDER } from './subscription-provider.token';

const BILLING_PERIOD_DAYS = 30;

const FEATURE_LABEL: Record<keyof PlanFeatures, string> = {
  delivery: 'Delivery',
  whatsapp: 'los avisos por WhatsApp',
  invoicing: 'la facturación',
};

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

@Injectable()
export class BillingService {
  constructor(
    // Crudo (sin tenant scope) — lo necesitan `processWebhook` (corre sin
    // JWT, sin tenantId en el contexto de ALS) y las lecturas de `Plan`
    // (catálogo global, no una tabla tenant-scoped).
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    // Mock o dLocal real según BILLING_PROVIDER (resuelto en BillingModule).
    @Inject(SUBSCRIPTION_PROVIDER) private readonly dlocal: SubscriptionProviderAdapter,
  ) {}

  listPlans() {
    return this.prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  }

  /**
   * Plan por defecto para una Tenant nueva: el de `sortOrder` más bajo entre
   * los activos, en vez de un código hardcodeado — más resiliente a que el
   * catálogo cambie de nombres sin romper el registro de tenants.
   */
  async getDefaultPlan() {
    const plan = await this.prisma.plan.findFirst({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    if (!plan) throw new NotFoundException('No hay ningún plan activo configurado');
    return plan;
  }

  async getMySubscription() {
    const sub = await this.tenantPrisma.client.subscription.findUniqueOrThrow({
      where: { tenantId: this.tenantPrisma.tenantId },
      include: { plan: true, pendingPlan: true },
    });
    const limits = sub.plan.limits as unknown as PlanLimits;
    const [branchCount, userCount] = await Promise.all([
      this.tenantPrisma.client.branch.count(),
      this.tenantPrisma.client.user.count({ where: { active: true } }),
    ]);
    return {
      ...sub,
      usage: {
        branches: branchCount,
        maxBranches: limits.maxBranches,
        users: userCount,
        maxUsers: limits.maxUsers,
      },
    };
  }

  async getFeatures(): Promise<PlanFeatures> {
    const sub = await this.tenantPrisma.client.subscription.findUniqueOrThrow({
      where: { tenantId: this.tenantPrisma.tenantId },
      include: { plan: true },
    });
    return sub.plan.features as unknown as PlanFeatures;
  }

  async hasFeature(feature: keyof PlanFeatures): Promise<boolean> {
    const features = await this.getFeatures();
    return features[feature] === true;
  }

  /**
   * Hace REAL el paywall que la UI de facturación ya anuncia. Hoy todos los
   * planes traen las 3 features en true, así que esto es no-op; pero si un plan
   * apaga una feature, el badge "No disponible" pasa a enforcarse de verdad en
   * vez de ser cosmético. 402 Payment Required es el status correcto para
   * "tu plan no lo incluye".
   */
  async assertFeature(feature: keyof PlanFeatures): Promise<void> {
    if (!(await this.hasFeature(feature))) {
      throw new ForbiddenException(`Tu plan no incluye ${FEATURE_LABEL[feature]}. Actualizá el plan para habilitarlo.`);
    }
  }

  listInvoices() {
    return this.tenantPrisma.client.subscriptionInvoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
  }

  /**
   * Usado por BranchesService.create antes de insertar una Branch nueva —
   * defensa retroactiva de los límites de plan (ver Fase 6 del plan
   * original: "2da sucursal en STARTER se bloquea").
   */
  async assertCanCreateBranch(): Promise<void> {
    const sub = await this.tenantPrisma.client.subscription.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
      include: { plan: true },
    });
    // No debería pasar (register() siempre crea una TRIAL), pero si falta
    // por algún motivo no bloqueamos la operación del restaurante por un
    // problema de billing — fail-open.
    if (!sub) return;

    const limits = sub.plan.limits as unknown as PlanLimits;
    const branchCount = await this.tenantPrisma.client.branch.count();
    if (!canCreateBranch(branchCount, limits.maxBranches)) {
      throw new ConflictException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `Tu plan "${sub.plan.name}" permite hasta ${limits.maxBranches} sucursal(es). Actualizá tu plan para agregar más.`,
        current: branchCount,
        limit: limits.maxBranches,
      });
    }
  }

  /**
   * Gemelo de `assertCanCreateBranch` para el límite de usuarios.
   *
   * Faltaba: `limits.maxUsers` estaba definido en los planes, se mostraba en la
   * página de facturación y **no se validaba en ningún lado** — un tenant en
   * Starter (5 usuarios) podía crear 500 gratis. El límite era decorativo.
   *
   * Cuenta solo usuarios ACTIVOS: dar de baja a alguien tiene que liberar el
   * cupo, si no el tenant queda trabado por gente que ya no trabaja ahí.
   */
  async assertCanCreateUser(): Promise<void> {
    const sub = await this.tenantPrisma.client.subscription.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
      include: { plan: true },
    });
    // Mismo criterio fail-open que en sucursales: un problema de billing no
    // puede dejar al restaurante sin poder operar.
    if (!sub) return;

    const limits = sub.plan.limits as unknown as PlanLimits;
    const userCount = await this.tenantPrisma.client.user.count({ where: { active: true } });
    if (userCount >= limits.maxUsers) {
      throw new ConflictException({
        code: 'PLAN_LIMIT_EXCEEDED',
        message: `Tu plan "${sub.plan.name}" permite hasta ${limits.maxUsers} usuario(s) activo(s). Desactivá alguno o actualizá tu plan.`,
        current: userCount,
        limit: limits.maxUsers,
      });
    }
  }

  /**
   * Crea un intento de suscripción pago (DLocal sandbox) para el plan
   * elegido. El plan solo se aplica de verdad cuando llega el webhook de
   * aprobación (`processWebhook`) — mismo patrón que `Payment` queda
   * PROCESSING hasta el webhook en Fase 3, para no activar un plan pago sin
   * confirmación real de cobro.
   */
  async subscribe(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.active) throw new NotFoundException('Plan no encontrado');

    const sub = await this.tenantPrisma.client.subscription.findUniqueOrThrow({
      where: { tenantId: this.tenantPrisma.tenantId },
    });

    const intent = await this.dlocal.createSubscriptionIntent({
      tenantId: this.tenantPrisma.tenantId,
      planId: plan.id,
      amount: Number(plan.priceMonthly),
      currency: plan.currency,
    });

    await this.tenantPrisma.client.subscription.update({
      where: { id: sub.id },
      data: { pendingPlanId: plan.id },
    });

    const now = new Date();
    await this.tenantPrisma.client.subscriptionInvoice.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        subscriptionId: sub.id,
        planId: plan.id,
        amount: plan.priceMonthly,
        currency: plan.currency,
        status: 'PENDING',
        providerPaymentId: intent.providerSubscriptionId,
        periodStart: now,
        periodEnd: addDays(now, BILLING_PERIOD_DAYS),
      },
    });

    return { providerSubscriptionId: intent.providerSubscriptionId, redirectUrl: intent.redirectUrl };
  }

  /**
   * Upgrade: se aplica de inmediato (simplificación MVP — en producción real
   * debería esperar el webhook de cobro como `subscribe`, igual que se
   * documentó para Fases 0-5: sin BullMQ/cron todavía).
   *
   * Downgrade: valida el uso actual contra los límites del plan nuevo. Si no
   * cabe, 409 PLAN_LIMIT_EXCEEDED con el detalle accionable en vez de un 500
   * genérico. Si cabe, se aplica ya (el campo `pendingPlanId`/`renewalDate`
   * queda listo para cuando se agregue el cron `subscription-billing` de la
   * Fase 8 y esto pase a aplicarse recién en la renovación).
   */
  async changePlan(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.active) throw new NotFoundException('Plan no encontrado');

    const sub = await this.tenantPrisma.client.subscription.findUniqueOrThrow({
      where: { tenantId: this.tenantPrisma.tenantId },
      include: { plan: true },
    });

    if (plan.id === sub.planId) {
      throw new BadRequestException('Ya estás en ese plan');
    }

    const isUpgrade = Number(plan.priceMonthly) >= Number(sub.plan.priceMonthly);

    if (!isUpgrade) {
      const limits = plan.limits as unknown as PlanLimits;
      const branchCount = await this.tenantPrisma.client.branch.count();
      if (!canDowngradeToPlan(branchCount, limits.maxBranches)) {
        throw new ConflictException({
          code: 'PLAN_LIMIT_EXCEEDED',
          message: `El plan "${plan.name}" permite hasta ${limits.maxBranches} sucursal(es), pero tenés ${branchCount}. Dá de baja sucursales antes de bajar de plan.`,
          current: branchCount,
          limit: limits.maxBranches,
        });
      }
    }

    const updated = await this.tenantPrisma.client.subscription.update({
      where: { id: sub.id },
      data: {
        planId: plan.id,
        pendingPlanId: null,
        status: 'ACTIVE',
        renewalDate: addDays(new Date(), BILLING_PERIOD_DAYS),
      },
      include: { plan: true },
    });

    return { ...updated, applied: 'immediate' as const };
  }

  /**
   * Procesa un webhook de DLocal (SaaS billing). Corre SIN contexto de
   * tenant (request pública, sin JWT) — todo acá usa `PrismaService` crudo,
   * nunca `TenantPrismaService`. El tenant se deriva del SubscriptionInvoice
   * encontrado por `providerPaymentId` (= `providerSubscriptionId` del
   * intent), no de la request. Reutiliza la misma tabla `PaymentWebhookEvent`
   * de la Fase 3 (con `scope: SAAS_BILLING`) — mismo motor de idempotencia
   * `(provider, eventId)`, sin reinventarlo para billing.
   */
  async processWebhook(
    provider: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
    body: { eventId: string; eventType: string; providerSubscriptionId: string },
  ) {
    if (provider !== 'dlocal') throw new BadRequestException(`Proveedor "${provider}" no soportado`);

    const signatureValid = this.dlocal.verifyWebhookSignature(rawBody, signatureHeader);

    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: body.eventId } },
    });
    if (existing?.processedAt) {
      return { ok: true, duplicate: true };
    }

    if (!signatureValid) {
      await this.prisma.paymentWebhookEvent.upsert({
        where: { provider_eventId: { provider, eventId: body.eventId } },
        update: { payload: body, signatureValid: false },
        create: {
          scope: 'SAAS_BILLING',
          provider,
          eventId: body.eventId,
          eventType: body.eventType,
          payload: body,
          signatureValid: false,
        },
      });
      throw new BadRequestException('Firma de webhook inválida');
    }

    const event = await this.prisma.paymentWebhookEvent.upsert({
      where: { provider_eventId: { provider, eventId: body.eventId } },
      update: { payload: body, signatureValid: true },
      create: {
        scope: 'SAAS_BILLING',
        provider,
        eventId: body.eventId,
        eventType: body.eventType,
        payload: body,
        signatureValid: true,
      },
    });

    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: { providerPaymentId: body.providerSubscriptionId },
    });
    if (!invoice) {
      throw new NotFoundException(
        `No se encontró un SubscriptionInvoice con providerSubscriptionId ${body.providerSubscriptionId}`,
      );
    }

    if (body.eventType === 'SUBSCRIPTION_APPROVED') {
      await this.prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      await this.prisma.subscription.update({
        where: { id: invoice.subscriptionId },
        data: {
          planId: invoice.planId,
          pendingPlanId: null,
          status: 'ACTIVE',
          renewalDate: invoice.periodEnd,
          pastDueSince: null,
        },
      });
    } else if (body.eventType === 'SUBSCRIPTION_FAILED') {
      await this.prisma.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: 'FAILED' },
      });
      await this.prisma.subscription.update({
        where: { id: invoice.subscriptionId },
        data: { status: 'PAST_DUE', pastDueSince: new Date() },
      });
    }

    await this.prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), tenantId: invoice.tenantId },
    });

    return { ok: true, duplicate: false };
  }
}
