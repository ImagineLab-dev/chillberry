import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../integrations/notifications.service';
import { logger } from '../../common/logging/logger';

/**
 * Manda el recordatorio de reserva por los avisos unas horas antes. Corre como
 * cron (cada 15 min), sin request ni tenant en contexto — por eso usa el
 * `PrismaService` crudo y consulta CROSS-tenant (es un job de sistema). El
 * `PushService` resuelve el destino por teléfono y recibe el tenant explícito,
 * así que no necesita el ALS.
 *
 * Ventana: reservas CONFIRMED cuyo `reservedFor` cae en las próximas 2 horas y
 * que todavía no recibieron el aviso (`reminderSent=false`). El flag evita
 * duplicados si el cron corre varias veces dentro de la ventana.
 */
@Injectable()
export class ReservationRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 */15 * * * *')
  async sendDueReminders(): Promise<void> {
    const now = new Date();
    const horizon = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const due = await this.prisma.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        reminderSent: false,
        customerPhone: { not: null },
        reservedFor: { gte: now, lte: horizon },
      },
      take: 200,
    });
    if (due.length === 0) return;

    for (const r of due) {
      await this.notifications
        .notifyReservationReminder(r.tenantId, r.customerPhone, r.customerName, r.reservedFor, r.partySize)
        .catch(() => {});
      // updateMany (no update): el cliente crudo no exige unique compuesto y el
      // id ya es único; marca enviado aunque el envío sea best-effort.
      await this.prisma.reservation.updateMany({ where: { id: r.id }, data: { reminderSent: true } });
    }
    logger.info({ count: due.length }, 'Recordatorios de reserva enviados');
  }
}
