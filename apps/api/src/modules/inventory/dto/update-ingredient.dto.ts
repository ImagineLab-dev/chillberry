import { IsBoolean, IsNumber, IsOptional, IsString, Length, Min, ValidateIf } from 'class-validator';

export class UpdateIngredientDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  unit?: string;

  // Acepta null explícito para quitar la alerta de stock bajo.
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  lowStockAt?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPerUnit?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
