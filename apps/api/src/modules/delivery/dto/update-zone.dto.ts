import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { DELIVERY_FEE_TYPE, type DeliveryFeeType } from '@chillberry/domain';

/** Edición de una zona ya creada. Sin `branchId`: una zona no se muda de
 *  sucursal. Todos los campos opcionales (PATCH parcial). */
export class UpdateZoneDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsEnum(DELIVERY_FEE_TYPE)
  feeType?: DeliveryFeeType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseFee?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  perKmFee?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  freeKmThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedMinutes?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number;
}
