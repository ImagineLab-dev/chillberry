import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { DELIVERY_FEE_TYPE, type DeliveryFeeType } from '@chillberry/domain';

export class CreateZoneDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsEnum(DELIVERY_FEE_TYPE)
  feeType!: DeliveryFeeType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  baseFee!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  perKmFee?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  freeKmThreshold?: number;

  @IsInt()
  @Min(1)
  estimatedMinutes!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minOrderAmount?: number;
}
