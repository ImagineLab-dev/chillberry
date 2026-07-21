import { IsNumber, Max, Min } from 'class-validator';

/**
 * Tipo de cambio para reconvertir el menú. Rango amplio: de PYG→USD el
 * multiplicador es chiquito (~0.00013), de USD→PYG es grande (~7300).
 */
export class ConvertPricesDto {
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0.00000001)
  @Max(10_000_000)
  rate!: number;
}
