import { IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** Conteo físico: setea el stock al valor CONTADO (el service calcula el delta
 *  y registra un StockMovement type COUNT). */
export class CountStockDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  countedQty!: number;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;
}
