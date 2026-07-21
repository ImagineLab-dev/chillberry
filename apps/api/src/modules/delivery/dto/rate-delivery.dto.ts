import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Calificación del cliente al repartidor: 1-5 + comentario opcional. */
export class RateDeliveryDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
