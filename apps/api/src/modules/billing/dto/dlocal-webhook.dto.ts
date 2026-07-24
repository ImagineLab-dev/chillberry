import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Webhook de dLocal (SaaS billing). Dos formas conviven en el mismo endpoint:
 *
 *  - REAL (dLocal Go): el body trae SÓLO `{ payment_id }` — el estado NO viene,
 *    se consulta por API (`retrievePaymentStatus`) y se correlaciona la
 *    suscripción por el `ref` (tenant) del query del `notification_url`.
 *  - MOCK (sandbox propio / tests): el evento ya normalizado
 *    (`eventId` + `eventType` + `providerSubscriptionId`).
 *
 * `processWebhook` distingue por la presencia de `payment_id`.
 */
export class DlocalWebhookDto {
  @IsOptional()
  @IsString()
  payment_id?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsIn(['SUBSCRIPTION_APPROVED', 'SUBSCRIPTION_FAILED'])
  eventType?: 'SUBSCRIPTION_APPROVED' | 'SUBSCRIPTION_FAILED';

  @IsOptional()
  @IsString()
  providerSubscriptionId?: string;
}
