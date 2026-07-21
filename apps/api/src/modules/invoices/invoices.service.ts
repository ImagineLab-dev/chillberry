import { Injectable } from '@nestjs/common';
import { INVOICE_KIND } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { DefaultFiscalAdapter } from './adapters/default-fiscal.adapter';

type OrderForInvoice = {
  id: string;
  tenantId: string;
  branchId: string;
  subtotal: unknown;
  total: unknown;
};

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscal: DefaultFiscalAdapter,
  ) {}

  /**
   * Idempotente por `orderId` (constraint único) — si ya existe una
   * factura para este pedido, la devuelve tal cual en vez de duplicar.
   * Usa `PrismaService` crudo a propósito: se llama desde
   * `PaymentsService.checkAndCompleteOrder`, que corre también en el
   * camino de webhook (sin JWT, sin tenant en ALS) — el tenantId viene del
   * propio `order`, no del contexto de la request.
   */
  async issueForOrder(order: OrderForInvoice) {
    const existing = await this.prisma.invoice.findUnique({ where: { orderId: order.id } });
    if (existing) return existing;

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: order.tenantId } });
    const series = 'A';
    const { number } = await this.fiscal.nextNumber(order.branchId, series);
    const { taxTotal, taxDetails } = this.fiscal.computeTax(Number(order.subtotal), tenant.countryCode);

    return this.prisma.invoice.create({
      data: {
        tenantId: order.tenantId,
        orderId: order.id,
        branchId: order.branchId,
        kind: INVOICE_KIND.Receipt,
        series,
        number,
        taxDetails: { ...taxDetails, taxTotal },
        totalAmount: Number(order.total),
        issuedAt: new Date(),
      },
    });
  }
}
