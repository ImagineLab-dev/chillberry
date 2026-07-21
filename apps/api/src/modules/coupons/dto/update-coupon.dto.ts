import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateCouponDto {
  @IsOptional()
  @IsString()
  @Length(3, 32)
  code?: string;

  // `null` limpia la descripción; `undefined` no la toca.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Length(0, 200)
  description?: string | null;

  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED_AMOUNT'])
  discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value?: number;

  // `null` quita la compra mínima / el tope de usos / el vencimiento.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
