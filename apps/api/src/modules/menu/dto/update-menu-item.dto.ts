import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, IsUrl, Length, Min, ValidateIf } from 'class-validator';

export class UpdateMenuItemDto {
  // `@ValidateIf` deja pasar `null` sin validar como UUID — así el frontend
  // puede mandar `categoryId: null` para "sacar" la categoría de un item
  // que ya tenía una, no solo asignarle una nueva. `@IsOptional()` sigue
  // cubriendo el caso "ni siquiera mandaron el campo" (no tocar el actual).
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  stationId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  // Precio para delivery. `null` = mismo precio en todos los canales; `undefined`
  // no lo toca.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deliveryPrice?: number | null;

  // "86": agotado por hoy (temporal, distinto de `active`).
  @IsOptional()
  @IsBoolean()
  soldOut?: boolean;

  // `null` limpia el costo cargado; `undefined` no lo toca.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  cost?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUrl({ require_tld: false })
  imageUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
