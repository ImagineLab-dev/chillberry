import { IsBoolean, IsIn, IsOptional, IsUrl, Matches } from 'class-validator';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Diseño visual de la carta pública de una sucursal. Todo opcional: lo que no
 * venga usa el default del front. Se guarda como JSON en `Branch.cartaTheme`.
 */
export class CartaThemeDto {
  /** Color principal de la carta de ESTA sucursal (pisa el brandColor del tenant). */
  @IsOptional()
  @Matches(HEX, { message: 'primaryColor debe ser un hex #RRGGBB' })
  primaryColor?: string;

  @IsOptional()
  @Matches(HEX, { message: 'accentColor debe ser un hex #RRGGBB' })
  accentColor?: string;

  /** Tipografía ("letra"). El front mapea cada opción a una familia real. */
  @IsOptional()
  @IsIn(['moderna', 'clasica', 'redondeada', 'elegante', 'condensada'])
  font?: 'moderna' | 'clasica' | 'redondeada' | 'elegante' | 'condensada';

  /** Disposición de los productos. */
  @IsOptional()
  @IsIn(['lista', 'grilla'])
  layout?: 'lista' | 'grilla';

  @IsOptional()
  @IsBoolean()
  showImages?: boolean;

  @IsOptional()
  @IsBoolean()
  showDescriptions?: boolean;

  /** Estilo de la portada/encabezado. */
  @IsOptional()
  @IsIn(['gradiente', 'imagen', 'solido'])
  headerStyle?: 'gradiente' | 'imagen' | 'solido';

  /** Logo propio de la sucursal (pisa el logo del restaurante en la carta).
   *  Subido a `/uploads/image` (URL http) o pegado como URL. */
  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string;
}
