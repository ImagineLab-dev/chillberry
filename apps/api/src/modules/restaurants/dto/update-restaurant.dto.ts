import { IsBoolean, IsOptional, IsString, IsUrl, Length, ValidateIf } from 'class-validator';

export class UpdateRestaurantDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUrl({ require_tld: false })
  logoUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
