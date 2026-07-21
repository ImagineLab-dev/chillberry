import { IsOptional, IsString, IsUrl, Length } from 'class-validator';

export class CreateRestaurantDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;
}
