/**
 * Contrato para envío de mensajes de WhatsApp (confirmaciones de pedido,
 * estado de delivery). Vive en `domain` sin dependencias de framework — la
 * implementación concreta (llamada real a la Graph API de Meta, o el modo
 * sandbox sin credenciales) vive en `apps/api`. Mismo patrón que
 * `PaymentProviderAdapter`/`SubscriptionProviderAdapter`.
 */
export type SendWhatsAppMessageInput = {
  /** Teléfono en formato E.164 (ej. "+595981234567"). */
  to: string;
  templateName: string;
  variables: Record<string, string>;
};

export type SendWhatsAppMessageResult = {
  externalMessageId: string;
};

export interface WhatsAppAdapter {
  sendTemplateMessage(input: SendWhatsAppMessageInput): Promise<SendWhatsAppMessageResult>;
}
