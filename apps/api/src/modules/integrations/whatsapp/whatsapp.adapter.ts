import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  SendWhatsAppMessageInput,
  SendWhatsAppMessageResult,
  WhatsAppAdapter as WhatsAppAdapterInterface,
} from '@chillberry/domain';
import { loadEnv } from '../../../config/env';
import { logger } from '../../../common/logging/logger';

const GRAPH_API_VERSION = 'v18.0';

/**
 * Envía confirmaciones de pedido/delivery por WhatsApp (Meta Cloud API).
 * Sin `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` configurados cae en
 * modo sandbox: loguea el mensaje que se habría enviado en vez de llamar a
 * la Graph API real — así el flujo completo (pedido completado -> intento de
 * notificación) se puede probar sin necesitar una cuenta de Meta Business.
 * Configurar esas dos env vars activa el envío real sin cambiar una línea
 * de los callers (mismo patrón que los adapters de pago/suscripción).
 */
@Injectable()
export class WhatsAppAdapter implements WhatsAppAdapterInterface {
  async sendTemplateMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult> {
    const env = loadEnv();

    if (!env.WHATSAPP_API_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      logger.info(
        { to: input.to, templateName: input.templateName, variables: input.variables },
        '[sandbox] WhatsApp no configurado — mensaje simulado, no enviado',
      );
      return { externalMessageId: `sandbox_${randomUUID()}` };
    }

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: input.to,
          type: 'template',
          template: {
            name: input.templateName,
            language: { code: 'es' },
            components: [
              {
                type: 'body',
                parameters: Object.values(input.variables).map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WhatsApp send failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { messages: { id: string }[] };
    return { externalMessageId: data.messages[0]!.id };
  }
}
