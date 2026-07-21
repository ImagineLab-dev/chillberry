import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PAYMENT_METHOD, PAYMENT_PROVIDER, type PaymentMethod, type PaymentProvider } from '@chillberry/domain';

export class CreatePaymentIntentDto {
  @IsUUID()
  orderId!: string;

  // Si se manda, el pago cubre solo esa parte de la cuenta (Fase 2 split) en
  // vez del total del pedido.
  @IsOptional()
  @IsUUID()
  billSplitId?: string;

  @IsEnum(PAYMENT_METHOD)
  method!: PaymentMethod;

  // Requerido para métodos electrónicos (CARD/QR/WALLET); ignorado para CASH.
  @IsOptional()
  @IsEnum(PAYMENT_PROVIDER)
  provider?: PaymentProvider;
}
