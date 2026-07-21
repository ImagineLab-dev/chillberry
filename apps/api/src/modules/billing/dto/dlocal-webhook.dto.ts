import { IsIn, IsString } from 'class-validator';

/**
 * Shape del webhook del proveedor DLOCAL simulado. Mismo criterio que
 * `MockPaymentWebhookDto` (Fase 3): específico del sandbox propio, un
 * proveedor real tiene su propio body/firma.
 */
export class DlocalWebhookDto {
  @IsString()
  eventId!: string;

  @IsIn(['SUBSCRIPTION_APPROVED', 'SUBSCRIPTION_FAILED'])
  eventType!: 'SUBSCRIPTION_APPROVED' | 'SUBSCRIPTION_FAILED';

  @IsString()
  providerSubscriptionId!: string;
}
