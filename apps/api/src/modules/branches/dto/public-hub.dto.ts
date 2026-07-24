import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * "Linktree" de una sucursal: la página de botones que ve el cliente al entrar
 * al link público (`/r/:slug`) cuando el hub está activo. Opt-in y apagada por
 * defecto — con `enabled: false` (o sin config) el link muestra la carta directo,
 * igual que siempre. Se guarda como JSON en `Branch.publicHub`, mismo patrón que
 * `cartaTheme`. Reusa el tema visual de la carta (colores/logo/portada).
 */

/** Tipos de botón. Los builtin resuelven su destino desde datos de la sucursal
 *  (teléfono, dirección/coordenadas); `custom` lleva una URL arbitraria. */
export const HUB_BUTTON_KINDS = ['menu', 'whatsapp', 'call', 'map', 'custom'] as const;
export type HubButtonKind = (typeof HUB_BUTTON_KINDS)[number];

/** Ícono para los links propios (el front lo mapea a un glifo). */
export const HUB_CUSTOM_ICONS = ['link', 'instagram', 'facebook', 'tiktok', 'web', 'star', 'pdf'] as const;
export type HubCustomIcon = (typeof HUB_CUSTOM_ICONS)[number];

export class PublicHubButtonDto {
  /** Id estable generado por el front — key de React y para reordenar/editar. */
  @IsString()
  @Length(1, 60)
  id!: string;

  @IsIn(HUB_BUTTON_KINDS)
  kind!: HubButtonKind;

  /** Etiqueta visible, editable por el dueño. */
  @IsString()
  @Length(1, 40)
  label!: string;

  @IsBoolean()
  enabled!: boolean;

  /** Sólo `custom`: URL destino. Se exige protocolo http/https EXPLÍCITO — sin él
   *  el `<a href>` del hub sería un link relativo y llevaría a la nada (los builtin
   *  no usan `url`). El front la normaliza (le antepone https://) antes de mandar. */
  @ValidateIf((o: PublicHubButtonDto) => o.kind === 'custom')
  @IsUrl(
    { require_tld: false, require_protocol: true, protocols: ['http', 'https'] },
    { message: 'El link tiene que ser una URL completa (con https://)' },
  )
  url?: string;

  /** Ícono para los links propios. */
  @IsOptional()
  @IsIn(HUB_CUSTOM_ICONS)
  icon?: HubCustomIcon;
}

export class PublicHubDto {
  /** Interruptor maestro. `false`/ausente → el link muestra la carta directo. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Frase corta bajo el nombre del local (ej. "Pedí online o reservá tu mesa"). */
  @IsOptional()
  @IsString()
  @Length(0, 120)
  headline?: string;

  /** Botones en el ORDEN en que se muestran. Máx 20 (12 propios + builtin). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PublicHubButtonDto)
  buttons?: PublicHubButtonDto[];
}
