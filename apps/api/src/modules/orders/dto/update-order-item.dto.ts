import { IsInt, Max, Min } from 'class-validator';

/** Cambio de cantidad de un ítem ya enviado. Para llevar a 0 se usa el DELETE. */
export class UpdateOrderItemDto {
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}
