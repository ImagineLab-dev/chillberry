import { IsIn, IsString } from 'class-validator';

/**
 * Shape del webhook del proveedor MOCK. Un proveedor real (Bancard/DLocal)
 * tiene su propio body — este DTO es específico de `provider: "mock"`.
 */
export class MockPaymentWebhookDto {
  @IsString()
  eventId!: string;

  @IsIn(['PAYMENT_APPROVED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED'])
  eventType!: 'PAYMENT_APPROVED' | 'PAYMENT_FAILED' | 'PAYMENT_REFUNDED';

  @IsString()
  providerPaymentId!: string;
}
