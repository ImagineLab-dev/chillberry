/**
 * Contrato que cualquier proveedor de cobro recurrente (DLocal en producción,
 * o el Mock de sandbox) debe implementar. Mismo patrón que
 * `PaymentProviderAdapter` (Fase 3) — vive en `domain` sin dependencias de
 * framework, la implementación concreta vive en `apps/api`.
 */
export type CreateSubscriptionIntentInput = {
  tenantId: string;
  planId: string;
  amount: number;
  currency: string;
};

export type CreateSubscriptionIntentResult = {
  providerSubscriptionId: string;
  /** URL de checkout hosteado del proveedor, si aplica. */
  redirectUrl?: string;
};

export type ProviderPaymentStatus = {
  /** Estado del proveedor. dLocal Go: PENDING | PAID | REJECTED | CANCELLED | EXPIRED. */
  status: string;
  /** Referencia del comercio en el pago (`order_id` de dLocal), si viene. */
  orderId: string | null;
};

export interface SubscriptionProviderAdapter {
  createSubscriptionIntent(input: CreateSubscriptionIntentInput): Promise<CreateSubscriptionIntentResult>;

  /** Valida la firma de un webhook entrante contra el body crudo (Buffer, no el JSON re-serializado). */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;

  /** Consulta el estado de un pago por id. dLocal manda SÓLO `payment_id` en el
   *  webhook (sin el estado), así que hay que consultarlo por API. Opcional: el
   *  proveedor mock manda el evento ya normalizado y no lo necesita. */
  retrievePaymentStatus?(paymentId: string): Promise<ProviderPaymentStatus>;
}
