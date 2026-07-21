import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Max, Min, ValidateNested } from 'class-validator';

/** Un tramo de atención. Minutos desde medianoche, hora local del tenant. */
export class BranchHourDto {
  /** 0=domingo .. 6=sábado. */
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  openMinute!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  closeMinute!: number;
}

/**
 * Reemplaza el horario semanal COMPLETO de la sucursal. La lista vacía borra
 * todos los horarios → la sucursal vuelve a "siempre abierta" (enforcement
 * opt-in). Se manda todo junto para que el guardado sea idempotente.
 */
export class SetBranchHoursDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BranchHourDto)
  hours!: BranchHourDto[];
}
