import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { tenantContext } from '../../common/tenant-context/tenant-context';
import { logger } from '../../common/logging/logger';
import { DeliveryService } from './delivery.service';

const STALE_SECONDS = 90;

/**
 * Reasignación automática de deliveries "colgados": un pedido que quedó
 * DRIVER_ASSIGNED pero el repartidor no aceptó en `STALE_SECONDS`. Antes esto
 * era manual (el TODO en delivery.service lo dejaba pendiente) y un pedido
 * podía quedar trabado si el repartidor nunca respondía.
 *
 * Corre como cron cada minuto, sin tenant en contexto: busca los stale con el
 * cliente crudo (cross-tenant) y por cada uno abre el contexto del tenant del
 * pedido (`tenantContext.run` + `setTenantId`) para que la reasignación use el
 * cliente tenant-scoped correcto.
 */
@Injectable()
export class DeliveryReassignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reassignStale(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_SECONDS * 1000);
    const stale = await this.prisma.delivery.findMany({
      where: { status: 'DRIVER_ASSIGNED', assignedAt: { lt: cutoff } },
      select: { id: true, tenantId: true },
      take: 50,
    });
    if (stale.length === 0) return;

    let reassigned = 0;
    for (const d of stale) {
      await tenantContext.run(async () => {
        tenantContext.setTenantId(d.tenantId);
        const ok = await this.delivery.reassignStale(d.id).catch(() => false);
        if (ok) reassigned++;
      });
    }
    logger.info({ found: stale.length, reassigned }, 'Reasignación automática de deliveries colgados');
  }
}
