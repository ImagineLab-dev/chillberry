import { Injectable } from '@nestjs/common';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { logger } from '../../common/logging/logger';

/**
 * Fachada de notificaciones salientes usada por los módulos de negocio
 * (Payments, Delivery) — mantiene el detalle de "qué template, qué
 * variables" fuera de esos services, y garantiza que una notificación
 * caída NUNCA tumbe el flujo que la dispara (pagar un pedido o entregar un
 * delivery no puede fallar porque WhatsApp esté caído).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly whatsapp: WhatsAppAdapter) {}

  async notifyOrderCompleted(phone: string | null, total: string): Promise<void> {
    if (!phone) return;
    await this.safeSend(phone, 'pedido_completado', { total });
  }

  /** El pedido salió de cocina. Para take away/delivery el cliente dejó teléfono
   *  y le llega el aviso; en dine-in normalmente no hay teléfono (al mozo se le
   *  avisa por el socket, no por WhatsApp). */
  async notifyOrderReady(phone: string | null, reference: string | null): Promise<void> {
    if (!phone) return;
    await this.safeSend(phone, 'pedido_listo', { referencia: reference ?? 'para retirar' });
  }

  async notifyDeliveryAssigned(phone: string | null, estimatedMinutes: number | null): Promise<void> {
    if (!phone) return;
    await this.safeSend(phone, 'delivery_asignado', {
      eta: estimatedMinutes != null ? String(estimatedMinutes) : 'a confirmar',
    });
  }

  async notifyDeliveryCompleted(phone: string | null): Promise<void> {
    if (!phone) return;
    await this.safeSend(phone, 'delivery_entregado', {});
  }

  /** Recordatorio de reserva (lo dispara el cron unas horas antes). */
  async notifyReservationReminder(
    phone: string | null,
    name: string,
    when: Date,
    partySize: number,
  ): Promise<void> {
    if (!phone) return;
    await this.safeSend(phone, 'recordatorio_reserva', {
      nombre: name,
      fecha: when.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }),
      personas: String(partySize),
    });
  }

  /** Encuesta de calificación post-visita: el cron manda el link unas horas
   *  después de cerrar el pedido. `link` es la URL pública `/encuesta/:token`. */
  async notifyFeedbackRequest(phone: string | null, link: string): Promise<void> {
    if (!phone) return;
    await this.safeSend(phone, 'encuesta_calificacion', { link });
  }

  /** Campaña de marketing a un segmento de clientes. `mensaje` es el texto que
   *  arma el dueño. Requiere una plantilla de marketing aprobada en Meta. */
  async notifyMarketingCampaign(phone: string | null, message: string): Promise<void> {
    if (!phone) return;
    await this.safeSend(phone, 'campana_marketing', { mensaje: message });
  }

  private async safeSend(to: string, templateName: string, variables: Record<string, string>): Promise<void> {
    try {
      await this.whatsapp.sendTemplateMessage({ to, templateName, variables });
    } catch (err) {
      logger.error({ err, to, templateName }, 'Fallo al enviar notificación de WhatsApp (no bloqueante)');
    }
  }
}
