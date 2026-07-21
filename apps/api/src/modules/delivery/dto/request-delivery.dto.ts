import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RequestDeliveryDto {
  @IsUUID()
  zoneId!: string;

  @IsString()
  @Length(3, 300)
  addressLine!: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;
}
