import { IsLatitude, IsLongitude, IsOptional, IsNumber, Min } from 'class-validator';

export class LocationPingDto {
  @IsLatitude()
  lat!: number;

  @IsLongitude()
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}
