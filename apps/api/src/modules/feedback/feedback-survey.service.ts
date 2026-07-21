import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../integrations/notifications.service';
import { loadEnv } from '../../config/env';
import { logger } from '../../common/logging/logger';

// La encuesta se manda unas horas DESPUÉS de cerrar el pedido (para que el
// cliente ya haya vivido la experiencia), pero no a pedidos demasiado viejos —
// sino, la primera corrida del cron encuestaría todo el histórico de una.
const SURVEY_DELAY_MS = 3 * 60 * 60 * 1000; // 3 horas
const SURVEY_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 horas

/**
 * Manda la encuesta de calificación post-visita por WhatsApp. Cron cada 15 min,
 * sin request ni tenant en contexto (job de sistema) → `PrismaService` crudo,
 * cross-tenant, con `tenantId` explícito por fila. Mismo patrón que los
 * recordatorios de reserva.
 *
 * Ventana: pedidos COMPLETED con teléfono, cerrados hace entre 3h y 48h, que
 * todavía no tienen una encuesta creada (`feedback` null). La fila `Feedback`
 * con `order_id` único evita duplicados si el cron corre varias veces.
 */
@Injectable()
export class FeedbackSurveyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 */15 * * * *')
  async sendDueSurveys(): Promise<void> {
    const now = new Date();
    const readyBefore = new Date(now.getTime() - SURVEY_DELAY_MS);
    const notOlderThan = new Date(now.getTime() - SURVEY_MAX_AGE_MS);

    const due = await this.prisma.order.findMany({
      where: {
        status: 'COMPLETED',
        customerPhone: { not: null },
        completedAt: { gte: notOlderThan, lte: readyBefore },
        feedback: { is: null },
      },
      select: { id: true, tenantId: true, branchId: true, waiterId: true, customerPhone: true },
      take: 200,
    });
    if (due.length === 0) return;

    const base = loadEnv().WEB_ORIGIN;
    let sent = 0;
    for (const o of due) {
      const token = randomUUID();
      try {
        await this.prisma.feedback.create({
          data: {
            tenantId: o.tenantId,
            orderId: o.id,
            branchId: o.branchId,
            waiterId: o.waiterId,
            customerPhone: o.customerPhone,
            token,
            sentAt: new Date(),
          },
        });
      } catch {
        // Carrera: otra corrida ya creó la encuesta de este pedido (order_id
        // único) — se saltea sin re-enviar.
        continue;
      }
      await this.notifications.notifyFeedbackRequest(o.customerPhone, `${base}/encuesta/${token}`).catch(() => {});
      sent += 1;
    }
    if (sent > 0) logger.info({ count: sent }, 'Encuestas de calificación enviadas');
  }
}
