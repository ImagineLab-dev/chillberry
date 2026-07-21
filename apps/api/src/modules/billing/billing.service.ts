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
  push: 'los avisos al teléfono',
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
      // El id del proveedor va en la SUSCRIPCIÓN: es lo que trae el webhook de
      // cada cobro mensual, y es contra lo que hay que correlacionarlo.
      data: { pendingPlanId: plan.id, providerSubscriptionId: intent.providerSubscriptionId },
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

    // Una suscripción suspendida o cancelada NO se revive desde acá. Antes el
    // update de abajo escribía `status: 'ACTIVE'` incondicionalmente, así que
    // el tenant al que el super-admin acababa de suspender por falta de pago se
    // reactivaba solo con un cambio de plan: la sanción era reversible por el
    // sancionado. Volver a habilitarlo es decisión del super-admin.
    if (sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') {
      throw new ForbiddenException(
        'Tu suscripción está suspendida. Escribinos a soporte@chillberry.app para reactivarla.',
      );
    }

    const isUpgrade = Number(plan.priceMonthly) > Number(sub.plan.priceMonthly);

    // UN UPGRADE SE COBRA. Antes se aplicaba en el acto, sin pasar por ningún
    // cobro: el dueño leía la lista de planes, tomaba el más caro y se lo
    // asignaba gratis. Los límites de sucursales y usuarios —que son la única
    // barrera de pago— se saltaban solos.
    //
    // Se delega en `subscribe`, que es el mismo camino del alta: crea el
    // checkout, deja el plan en `pendingPlanId` y lo aplica recién cuando llega
    // el webhook del cobro aprobado.
    if (isUpgrade) {
      const checkout = await this.subscribe(plan.id);
      return { ...checkout, applied: 'pending_payment' as const };
    }

    {
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
        // El estado NO se toca. Cambiar de plan no es un pago: promover a
        // ACTIVE desde acá blanqueaba un PAST_DUE (deuda impaga) como si se
        // hubiera cobrado. Quien mueve el estado es el webhook de cobro
        // (`processWebhook`) o el super-admin.
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

    // Se resuelve por la SUSCRIPCIÓN, no por una factura. El webhook trae el id
    // de la suscripción y llega una vez por mes; buscar una factura con ese id
    // sólo acertaba el primer cobro (hay una sola factura por suscripción), y
    // del segundo en adelante reescribía esa misma y dejaba `renewalDate` en
    // una fecha ya pasada, sin historial de lo cobrado.
    const sub = await this.prisma.subscription.findFirst({
      where: { providerSubscriptionId: body.providerSubscriptionId },
    });
    if (!sub) {
      throw new NotFoundException(
        `No se encontró una suscripción con providerSubscriptionId ${body.providerSubscriptionId}`,
      );
    }

    // Factura del período que se está cobrando: la que quedó PENDING al
    // contratar (primer cobro) o ninguna todavía (renovación).
    const pendiente = await this.prisma.subscriptionInvoice.findFirst({
      where: { subscriptionId: sub.id, status: 'PENDING' },
      orderBy: { periodStart: 'desc' },
    });

    if (body.eventType === 'SUBSCRIPTION_APPROVED') {
      const planId = sub.pendingPlanId ?? sub.planId;
      let periodEnd: Date;

      if (pendiente) {
        await this.prisma.subscriptionInvoice.update({
          where: { id: pendiente.id },
          data: { status: 'PAID', paidAt: new Date(), providerPaymentId: body.providerSubscriptionId },
        });
        periodEnd = pendiente.periodEnd;
      } else {
        // RENOVACIÓN: se emite la factura del período nuevo. Arranca donde
        // terminó el anterior, no en la fecha de hoy — si el webhook llega con
        // demora, el cliente no pierde los días que ya pagó.
        const anterior = await this.prisma.subscriptionInvoice.findFirst({
          where: { subscriptionId: sub.id },
          orderBy: { periodEnd: 'desc' },
        });
        const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
        const periodStart = anterior?.periodEnd ?? new Date();
        periodEnd = addDays(periodStart, BILLING_PERIOD_DAYS);

        await this.prisma.subscriptionInvoice.create({
          data: {
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            planId,
            amount: plan?.priceMonthly ?? 0,
            currency: plan?.currency ?? 'USD',
            status: 'PAID',
            paidAt: new Date(),
            providerPaymentId: body.providerSubscriptionId,
            periodStart,
            periodEnd,
          },
        });
      }

      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          planId,
          pendingPlanId: null,
          status: 'ACTIVE',
          renewalDate: periodEnd,
          pastDueSince: null,
        },
      });
    } else if (body.eventType === 'SUBSCRIPTION_FAILED') {
      if (pendiente) {
        await this.prisma.subscriptionInvoice.update({
          where: { id: pendiente.id },
          data: { status: 'FAILED' },
        });
      }
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE', pastDueSince: new Date() },
      });
    }

    await this.prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), tenantId: sub.tenantId },
    });

    return { ok: true, duplicate: false };
  }
}
