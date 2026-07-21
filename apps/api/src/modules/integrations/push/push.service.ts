import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { logger } from '../../../common/logging/logger';
import { PushAdapter, type AvisoPush } from './push.adapter';

/**
 * Envío de avisos a una persona, resuelta por teléfono.
 *
 * Se usa `PrismaService` crudo con `tenantId` explícito porque varios de los
 * llamadores son crones que recorren todos los restaurantes (recordatorios de
 * reserva, encuestas) y ahí no hay contexto de tenant.
 */
@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushAdapter,
  ) {}

  /**
   * Guarda o actualiza la suscripción de un dispositivo.
   *
   * Va por `endpoint` porque es lo que identifica al dispositivo: si la misma
   * persona vuelve a entrar desde el mismo teléfono, se actualiza en vez de
   * duplicarle el aviso.
   */
  async suscribir(args: {
    tenantId: string;
    phone: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userId?: string | null;
  }) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: args.endpoint },
      create: {
        tenantId: args.tenantId,
        phone: args.phone,
        endpoint: args.endpoint,
        p256dh: args.p256dh,
        auth: args.auth,
        userId: args.userId ?? null,
      },
      // El teléfono puede cambiar: un mismo dispositivo lo usa otra persona, o
      // el comensal corrige su número. Gana el último.
      update: { tenantId: args.tenantId, phone: args.phone, p256dh: args.p256dh, auth: args.auth },
    });
    return { ok: true };
  }

  /**
   * Manda un aviso a TODOS los dispositivos de ese teléfono.
   *
   * Nunca lanza: si el aviso no sale, el flujo que lo disparó (cobrar, entregar)
   * tiene que seguir igual.
   */
  async avisar(tenantId: string, phone: string | null, aviso: AvisoPush): Promise<void> {
    if (!phone) return;

    try {
      const destinos = await this.prisma.pushSubscription.findMany({
        where: { tenantId, phone },
      });
      if (destinos.length === 0) return;

      for (const d of destinos) {
        const resultado = await this.push.enviar(d, aviso);

        if (resultado === 'muerta') {
          // El navegador la dio de baja. Borrarla es parte del trabajo: si no,
          // cada aviso futuro reintenta contra un destino que ya no existe.
          await this.prisma.pushSubscription.delete({ where: { id: d.id } }).catch(() => {});
          logger.info({ endpoint: d.endpoint.slice(0, 40) }, 'Suscripción push dada de baja por el navegador');
        } else if (resultado === 'ok') {
          await this.prisma.pushSubscription
            .update({ where: { id: d.id }, data: { lastOkAt: new Date() } })
            .catch(() => {});
        }
      }
    } catch (err) {
      logger.error({ err, phone }, 'Fallo al enviar aviso push (no bloqueante)');
    }
  }
}
