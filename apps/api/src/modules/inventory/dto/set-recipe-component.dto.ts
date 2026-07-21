import { IsNumber, IsUUID, Max, Min } from 'class-validator';

export class SetRecipeComponentDto {
  @IsUUID()
  ingredientId!: string;

  /** Cuánto de este insumo consume UNA unidad del producto. Acotado a la
   *  columna Decimal(14,3). */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  quantity!: number;
}
