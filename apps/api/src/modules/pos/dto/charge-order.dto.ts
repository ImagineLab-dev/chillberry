import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { PAYMENT_METHOD, PAYMENT_PROVIDER, type PaymentMethod, type PaymentProvider } from '@chillberry/domain';

export class ChargeLineDto {
  @IsEnum(PAYMENT_METHOD)
  method!: PaymentMethod;

  /** Monto que aplica a la cuenta. La suma de los `amount` tiene que dar el total. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /** Propina de esta línea, aparte del `amount`. No entra en la validación de
   *  que los pagos cuadren con el total — es un extra que va al mozo. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tip?: number;

  @IsOptional()
  @IsEnum(PAYMENT_PROVIDER)
  provider?: PaymentProvider;
}

export class ChargeOrderDto {
  // Si se manda, el cobro es solo por esa parte de la cuenta (Fase 2 split).
  @IsOptional()
  @IsUUID()
  billSplitId?: string;

  /**
   * Clave de idempotencia generada por el CLIENTE, una por intento de cobro.
   *
   * Tiene que venir del cliente sí o sí: la versión anterior la generaba en el
   * servidor con `randomBytes(16)` en cada llamada, así que el `@unique` de
   * `Payment.idempotencyKey` era matemáticamente incapaz de dispararse y la
   * idempotencia era decorativa. Un doble click en "Cobrar" cobraba dos veces.
   *
   * Reintentar el mismo cobro con la misma clave devuelve el pago original en
   * vez de crear uno nuevo.
   */
  @IsUUID()
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChargeLineDto)
  payments!: ChargeLineDto[];
}
