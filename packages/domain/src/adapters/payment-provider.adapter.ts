/**
 * Contrato que cualquier proveedor de pago (Bancard, Mercado Pago, Stripe,
 * DLocal, o el Mock de sandbox) debe implementar. Vive en `domain` (sin
 * dependencias de framework) — la implementación concreta de cada proveedor
 * vive en `apps/api` porque necesita SDKs/HTTP/crypto de Node.
 */
export type CreatePaymentIntentInput = {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
};

export type CreatePaymentIntentResult = {
  providerPaymentId: string;
  /** URL de checkout hosteado, si el proveedor lo requiere (no todos). */
  redirectUrl?: string;
};

export interface PaymentProviderAdapter {
  createIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult>;

  /** Valida la firma de un webhook entrante contra el body crudo (Buffer, no el JSON re-serializado). */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
}
