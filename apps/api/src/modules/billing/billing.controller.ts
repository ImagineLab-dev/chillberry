import { Body, Controller, Get, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { BillingService } from './billing.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // Catálogo global de planes (`prisma.plan`, no tenant-scoped). Incluye
  // SUPER_ADMIN porque `app/super-admin/tenants/[id]` lo usa para poblar el
  // selector de plan al que mueve a un tenant.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.SuperAdmin)
  @Get('plans')
  listPlans() {
    return this.billing.listPlans();
  }

  // Datos de la suscripción del tenant (plan, ciclo, consumo) — información
  // comercial. Caller: `app/admin/billing/page.tsx`. Sin SUPER_ADMIN: resuelve
  // por `tenantPrisma.tenantId`, que un super admin no tiene.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('subscription')
  getSubscription() {
    return this.billing.getMySubscription();
  }

  // Sin callers en el front hoy. Expone los features del plan contratado, así
  // que se queda con el mismo alcance que el resto de la lectura de billing.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('features')
  getFeatures() {
    return this.billing.getFeatures();
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('invoices')
  listInvoices() {
    return this.billing.listInvoices();
  }

  @Roles(USER_ROLE.Owner)
  @Post('subscribe')
  subscribe(@Body() dto: SubscribeDto) {
    return this.billing.subscribe(dto.planId);
  }

  @Roles(USER_ROLE.Owner)
  @Post('change-plan')
  changePlan(@Body() dto: ChangePlanDto) {
    return this.billing.changePlan(dto.planId);
  }

  // Cancelar/reactivar sólo el dueño: es una decisión de negocio, no operativa.
  @Roles(USER_ROLE.Owner)
  @Post('cancel')
  cancel() {
    return this.billing.cancelSubscription();
  }

  @Roles(USER_ROLE.Owner)
  @Post('reactivate')
  reactivate() {
    return this.billing.reactivateSubscription();
  }
}
