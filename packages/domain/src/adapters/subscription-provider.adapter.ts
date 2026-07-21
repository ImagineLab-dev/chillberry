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

export interface SubscriptionProviderAdapter {
  createSubscriptionIntent(input: CreateSubscriptionIntentInput): Promise<CreateSubscriptionIntentResult>;

  /** Valida la firma de un webhook entrante contra el body crudo (Buffer, no el JSON re-serializado). */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
}
