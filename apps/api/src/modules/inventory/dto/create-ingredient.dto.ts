import { IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

// Topes alineados a las columnas Decimal del schema: stock/umbral son
// Decimal(14,3) y el costo Decimal(14,4). Sin `@Max`, un valor gigante
// desbordaba la columna y tiraba 500 en vez de un 400 validado.
const MAX_QTY = 9_999_999_999; // holgado bajo Decimal(14,3)
const MAX_COST = 999_999_999; // holgado bajo Decimal(14,4)

export class CreateIngredientDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  @Length(1, 20)
  unit!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_QTY)
  stockQty?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_QTY)
  lowStockAt?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_COST)
  costPerUnit?: number;
}
