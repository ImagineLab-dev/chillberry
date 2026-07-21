import { IsOptional, IsString, Length, Matches } from 'class-validator';

/** Un día puntual en que la sucursal NO abre (feriado, vacaciones). */
export class CreateClosureDto {
  /** Fecha 'YYYY-MM-DD' (día local del tenant). */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha debe tener formato YYYY-MM-DD' })
  date!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  reason?: string;
}
