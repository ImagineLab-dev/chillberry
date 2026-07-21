import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CartaThemeDto } from './carta-theme.dto';

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(3, 240)
  address?: string;

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

  // El front sube la imagen a `/uploads/image` (devuelve una URL http) o pega una
  // URL — en ambos casos es una URL válida.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUrl({ require_tld: false })
  coverImageUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // --- Carta pública compartible (`/r/:slug`) ---

  /** Slug para la URL pública. URL-safe: minúsculas, números y guiones (no al
   *  principio/fin). Único global — si colisiona, el service devuelve 409. */
  @IsOptional()
  @IsString()
  @Length(3, 40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El enlace solo puede tener minúsculas, números y guiones',
  })
  publicSlug?: string;

  @IsOptional()
  @IsBoolean()
  publicOrderingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  acceptsDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  acceptsPickup?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  deliveryFee?: number;

  /**
   * Ventana de DELIVERY en minutos desde medianoche (hora local del tenant).
   * `null` en cualquiera de los dos = sin restricción de ese lado. Corte
   * adicional al horario general. Ver `isWithinDeliveryWindow`.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(1439)
  deliveryStartMinute?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(1439)
  deliveryEndMinute?: number | null;

  /** Diseño visual de la carta de esta sucursal. `null` lo resetea al default. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @ValidateNested()
  @Type(() => CartaThemeDto)
  cartaTheme?: CartaThemeDto | null;
}
