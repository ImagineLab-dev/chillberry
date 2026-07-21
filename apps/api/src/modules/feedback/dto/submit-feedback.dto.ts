import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Respuesta del cliente a la encuesta: estrellas (1-5) + comentario opcional. */
export class SubmitFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
