import { Injectable } from '@nestjs/common';
import { PushService } from './push/push.service';

/**
 * Fachada de avisos salientes para los módulos de negocio (Payments, Delivery,
 * Reservas, Feedback, Marketing). Mantiene el "qué se dice" fuera de esos
 * services, y garantiza que un aviso caído NUNCA tumbe el flujo que lo dispara:
 * cobrar un pedido no puede fallar porque una notificación no salga.
 *
 * El transporte son **notificaciones push del navegador**. Antes era WhatsApp y
 * se sacó por dos motivos: la vía oficial obliga a cada restaurante a tener
 * cuenta de Meta con plantillas aprobadas una por una, y la vía por QR arriesga
 * que le bloqueen la línea del negocio — el número impreso en su menú y en su
 * puerta, con todo el historial de sus clientes.
 *
 * El push llega al teléfono con la página cerrada, no depende de terceros y no
 * se puede bloquear. Su límite honesto: en iPhone funciona sólo si el cliente
 * agrega el sitio a su pantalla de inicio, porque Apple lo exige.
 *
 * Va `tenantId` en todas: la misma persona puede pedir en dos restaurantes
 * distintos, y cada uno le habla de lo suyo.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly push: PushService) {}

  async notifyOrderCompleted(tenantId: string, phone: string | null, total: string): Promise<void> {
    await this.push.avisar(tenantId, phone, {
      titulo: 'Pedido cobrado',
      cuerpo: `Listo, tu pedido de ${total} quedó pago. ¡Gracias!`,
      etiqueta: 'pedido',
    });
  }

  /**
   * Salió de cocina. En dine-in normalmente no hay teléfono: al mozo se le
   * avisa por el socket, que ya tiene la pantalla abierta delante.
   */
  async notifyOrderReady(tenantId: string, phone: string | null, reference: string | null): Promise<void> {
    await this.push.avisar(tenantId, phone, {
      titulo: '¡Tu pedido está listo!',
      cuerpo: reference ? `Ya podés retirarlo — ${reference}` : 'Ya podés retirarlo.',
      etiqueta: 'pedido',
    });
  }

  async notifyDeliveryAssigned(
    tenantId: string,
    phone: string | null,
    estimatedMinutes: number | null,
    trackingToken?: string | null,
  ): Promise<void> {
    await this.push.avisar(tenantId, phone, {
      titulo: 'Tu pedido va en camino',
      cuerpo:
        estimatedMinutes != null ? `Llega en unos ${estimatedMinutes} minutos.` : 'Un repartidor ya lo tiene.',
      // Al tocar el aviso se abre el mapa del seguimiento, que es exactamente
      // lo que la persona quiere hacer a continuación.
      url: trackingToken ? `/track/${trackingToken}` : undefined,
      etiqueta: 'delivery',
    });
  }

  async notifyDeliveryCompleted(tenantId: string, phone: string | null): Promise<void> {
    await this.push.avisar(tenantId, phone, {
      titulo: 'Pedido entregado',
      cuerpo: '¡Que lo disfrutes! Gracias por tu compra.',
      etiqueta: 'delivery',
    });
  }

  /** Recordatorio de reserva (lo dispara el cron unas horas antes). */
  async notifyReservationReminder(
    tenantId: string,
    phone: string | null,
    name: string,
    when: Date,
    partySize: number,
    /** Timezone del restaurante. `reservedFor` es un instante absoluto; sin esto
     *  `toLocaleString` usaba la hora del SERVER (UTC) y el cliente veía la hora
     *  corrida (una reserva 20:00 en Asunción le llegaba como "23:00"). */
    timeZone?: string,
  ): Promise<void> {
    const hora = when.toLocaleString('es', {
      timeStyle: 'short',
      ...(timeZone ? { timeZone } : {}),
    });
    await this.push.avisar(tenantId, phone, {
      // "hoy" no: el recordatorio puede dispararse cruzando la medianoche para
      // una reserva del día siguiente.
      titulo: 'Te esperamos',
      cuerpo: `${name}, tu reserva para ${partySize} es a las ${hora}.`,
      etiqueta: 'reserva',
    });
  }

  /** Encuesta post-visita: el cron la manda unas horas después de cerrar el pedido. */
  async notifyFeedbackRequest(tenantId: string, phone: string | null, link: string): Promise<void> {
    await this.push.avisar(tenantId, phone, {
      titulo: '¿Cómo estuvo todo?',
      cuerpo: 'Contanos en 10 segundos, nos ayuda un montón.',
      url: link,
      etiqueta: 'encuesta',
    });
  }

  /** Campaña a un segmento de clientes. `message` es el texto que arma el dueño. */
  async notifyMarketingCampaign(tenantId: string, phone: string | null, message: string): Promise<void> {
    await this.push.avisar(tenantId, phone, {
      titulo: 'Novedades',
      cuerpo: message,
      etiqueta: 'marketing',
    });
  }
}
