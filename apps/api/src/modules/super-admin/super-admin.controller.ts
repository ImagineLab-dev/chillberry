import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { strictThrottle } from '../../common/security/throttle.util';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { SystemTenantGuard } from './system-tenant.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SuperAdminService } from './super-admin.service';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { ChangeTenantPlanDto } from './dto/change-tenant-plan.dto';
import { UpdateTenantSubscriptionDto } from './dto/update-tenant-subscription.dto';
import { ListAuditDto } from './dto/list-audit.dto';

/**
 * Panel interno de Smartia. Cruza el aislamiento multi-tenant a propósito, así
 * que el `@Roles` va A NIVEL DE CLASE y ningún handler lo pisa: no existe
 * forma de agregar un endpoint acá y olvidarse del guard.
 *
 * SUPER_ADMIN va SOLO — nunca junto a Owner/Admin en el mismo `@Roles`. Un
 * OWNER que entre a cualquier ruta de este controller tiene que comer 403,
 * porque estos endpoints devuelven datos de OTROS tenants (sus competidores).
 * `RolesGuard` resuelve con `getAllAndOverride([handler, class])`: sin
 * `@Roles` en el handler, gana el de la clase.
 */
@Roles(USER_ROLE.SuperAdmin)
// Defensa en profundidad: además del rol, exige que el super-admin pertenezca
// al tenant sistema (ver SystemTenantGuard).
@UseGuards(SystemTenantGuard)
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly superAdmin: SuperAdminService) {}

  @Get('tenants')
  listTenants(@Query() query: ListTenantsDto) {
    return this.superAdmin.listTenants(query);
  }

  // Antes que `tenants/:id` no hace falta ordenar nada: 'metrics' y 'audit'
  // cuelgan de otra ruta base, no colisionan con el param.
  @Get('metrics')
  getMetrics() {
    return this.superAdmin.getMetrics();
  }

  @Get('audit')
  listAudit(@Query() query: ListAuditDto) {
    return this.superAdmin.listAudit(query);
  }

  @Get('tenants/:id')
  getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.superAdmin.getTenant(id);
  }

  // Rate limit propio en las escrituras, más estricto que el global (60/min):
  // ninguna de estas acciones es de alta frecuencia — un humano cambia un plan
  // cada tanto, no 60 veces por minuto. Un pico acá es un script suelto o un
  // token de super admin robado; el techo bajo achica la ventana.
  @Throttle(strictThrottle(10))
  @Patch('tenants/:id/plan')
  changePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeTenantPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // El `superAdminId` sale del JWT verificado, NUNCA del body — si viniera
    // del cliente, el autor de cada línea de la auditoría sería elegible por
    // el mismo que se está auditando.
    return this.superAdmin.changePlan(id, dto, user.id);
  }

  @Throttle(strictThrottle(10))
  @Patch('tenants/:id/subscription')
  updateSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.superAdmin.updateSubscription(id, dto, user.id);
  }
}
