import { IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** Ajuste de stock: `delta` positivo repone, negativo corrige a la baja.
 *  Acotado para no desbordar la columna Decimal(14,3) del stock. Cada ajuste
 *  queda registrado como `StockMovement` (type ADJUST por defecto, o WASTE para
 *  merma), con motivo opcional. */
export class AdjustStockDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(-9_999_999_999)
  @Max(9_999_999_999)
  delta!: number;

  @IsOptional()
  @IsIn(['ADJUST', 'WASTE'])
  type?: 'ADJUST' | 'WASTE';

  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;
}
