import { IsIn, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { DLOCAL_COUNTRIES, HEX_COLOR_REGEX } from '@chillberry/domain';

const COUNTRY_CODES = DLOCAL_COUNTRIES.map((c) => c.countryCode);

export class UpdateTenantSettingsDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  /** Timezone IANA (ej. 'America/Asuncion'). Define el "hoy" del dashboard y el
   *  bucketing de reportes. Se valida contra Intl en el service. */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  timezone?: string;

  // Un solo campo para elegir — la moneda se deriva del país (ver
  // TenantSettingsService), mismo criterio que en el registro.
  @IsOptional()
  @IsString()
  @IsIn(COUNTRY_CODES)
  countryCode?: string;

  /**
   * Color de marca para la carta pública, hex `#RRGGBB`. `null` vuelve al
   * violeta de Chillberry.
   *
   * No se valida el contraste acá a propósito: el color del texto encima se
   * DERIVA de la luminancia en cada render (`brandTokens` en @chillberry/domain),
   * así que cualquier color queda legible. Prohibirle colores al tenant sería
   * peor experiencia y no haría falta.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(HEX_COLOR_REGEX, { message: 'brandColor debe ser un hex tipo #RRGGBB' })
  brandColor?: string | null;

  /**
   * Subdominio público editable: `<publicSubdomain>.chillberry.io`. Es un label
   * DNS, así que sólo minúsculas, números y guiones (sin guion al inicio/fin).
   * `null` lo borra. Único global (409 si choca) y con una lista de reservados
   * que se valida en el service.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Length(3, 40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El subdominio solo admite minúsculas, números y guiones',
  })
  publicSubdomain?: string | null;
}
