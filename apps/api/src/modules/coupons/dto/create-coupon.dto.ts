import { IsBoolean, IsIn, IsISO8601, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateCouponDto {
  /** Se normaliza a MAYÚSCULAS sin espacios en el service. */
  @IsString()
  @Length(3, 32)
  code!: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string;

  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  discountType!: 'PERCENTAGE' | 'FIXED_AMOUNT';

  /** % (1-100) o monto fijo — el rango exacto lo valida el service según el tipo. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
