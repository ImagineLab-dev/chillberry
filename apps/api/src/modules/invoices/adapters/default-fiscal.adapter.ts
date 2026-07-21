import { Injectable } from '@nestjs/common';
import type { FiscalAdapter, FiscalNumberResult, TaxComputation } from '@chillberry/domain';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Adapter fiscal por defecto — numeración secuencial simple, sin impuestos
 * (ningún país está configurado todavía con tasas reales). Cambiar de país
 * o pasar a un régimen con IVA real es agregar otra clase que implemente
 * `FiscalAdapter`, no reescribir el flujo de facturación.
 */
@Injectable()
export class DefaultFiscalAdapter implements FiscalAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async nextNumber(branchId: string, series: string): Promise<FiscalNumberResult> {
    // `update` con `increment` es un solo UPDATE atómico — Postgres serializa
    // updates concurrentes sobre la misma fila, así que dos checkouts a la
    // vez nunca terminan con el mismo número.
    const counter = await this.prisma.invoiceCounter.upsert({
      where: { branchId_series: { branchId, series } },
      update: { lastNumber: { increment: 1 } },
      create: { tenantId: await this.tenantIdForBranch(branchId), branchId, series, lastNumber: 1 },
    });
    return { series, number: String(counter.lastNumber).padStart(7, '0') };
  }

  computeTax(_subtotal: number, countryCode: string): TaxComputation {
    return { taxTotal: 0, taxDetails: { countryCode, taxRate: 0, note: 'Sin régimen fiscal configurado aún' } };
  }

  private async tenantIdForBranch(branchId: string): Promise<string> {
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    return branch.tenantId;
  }
}
