import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, IsUrl, Length } from 'class-validator';

export class CreateBranchDto {
  @IsUUID()
  restaurantId!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @Length(3, 240)
  address!: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @Length(6, 30)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  coverImageUrl?: string;
}
