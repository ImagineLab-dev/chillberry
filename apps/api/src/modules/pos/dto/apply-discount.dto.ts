import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { DISCOUNT_TYPE, type DiscountType } from '@chillberry/domain';

export class ApplyDiscountDto {
  @IsUUID()
  orderId!: string;

  @IsEnum(DISCOUNT_TYPE)
  type!: DiscountType;

  // PERCENTAGE: 0-100 (porcentaje). FIXED_AMOUNT/COUPON: monto en moneda.
  // El tope del 100% para PERCENTAGE se valida en el service: acá `value`
  // significa dos cosas distintas según `type` y un @Max fijo rompería los
  // montos.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value!: number;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  couponCode?: string;

  /**
   * Obligatorio a propósito: un descuento sin motivo es indistinguible de un
   * robo. `Discount.appliedById` ya guarda quién lo hizo; sin el porqué, esa
   * evidencia no sirve para nada cuando el dueño audita el turno.
   */
  @IsString()
  @Length(3, 300)
  reason!: string;
}
