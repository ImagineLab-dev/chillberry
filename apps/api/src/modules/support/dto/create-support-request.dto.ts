import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export const SUPPORT_REQUEST_TYPES = ['BUG', 'SUGGESTION'] as const;
export type SupportRequestTypeDto = (typeof SUPPORT_REQUEST_TYPES)[number];

/** Reporte de problema o sugerencia que un restaurante le manda a Chillberry. */
export class CreateSupportRequestDto {
  @IsIn(SUPPORT_REQUEST_TYPES, { message: 'El tipo debe ser BUG o SUGGESTION' })
  type!: SupportRequestTypeDto;

  @IsString()
  @Length(5, 2000, { message: 'Contanos un poco más (entre 5 y 2000 caracteres)' })
  message!: string;

  /** Contexto opcional (pantalla donde pasó, navegador). Lo completa el front. */
  @IsOptional()
  @IsString()
  @Length(0, 300)
  context?: string;
}
