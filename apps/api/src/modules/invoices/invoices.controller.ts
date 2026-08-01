import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { assertPuedeUsarSucursal } from '../../common/security/branch-scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';

@Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Cashier)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get(':orderId')
  async getByOrder(@Param('orderId', ParseUUIDPipe) orderId: string, @CurrentUser() user: AuthenticatedUser) {
    const invoice = await this.tenantPrisma.client.invoice.findUnique({ where: { orderId } });
    if (!invoice) throw new NotFoundException('Todavía no se emitió comprobante para este pedido');
    // Aislamiento por sucursal: la factura lleva montos, impuestos y numeración
    // fiscal de su sucursal. Un cajero atado a la sucursal A no puede leer la de la
    // B con sólo el orderId (mismo criterio que payments.listByOrder).
    assertPuedeUsarSucursal(user, invoice.branchId);
    return invoice;
  }
}
