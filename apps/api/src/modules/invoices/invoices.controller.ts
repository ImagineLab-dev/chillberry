import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';

@Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Cashier)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get(':orderId')
  async getByOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    const invoice = await this.tenantPrisma.client.invoice.findUnique({ where: { orderId } });
    if (!invoice) throw new NotFoundException('Todavía no se emitió comprobante para este pedido');
    return invoice;
  }
}
