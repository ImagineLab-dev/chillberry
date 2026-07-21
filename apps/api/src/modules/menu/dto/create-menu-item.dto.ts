import { IsNumber, IsOptional, IsString, IsUUID, IsUrl, Length, Min } from 'class-validator';

export class CreateMenuItemDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  stationId?: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  /** Precio para delivery. Omitir = mismo precio que en salón. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deliveryPrice?: number;

  /** Costo de producción (insumos). Opcional — se usa para el margen en
   *  reportes, nunca se muestra al comensal. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;
}
