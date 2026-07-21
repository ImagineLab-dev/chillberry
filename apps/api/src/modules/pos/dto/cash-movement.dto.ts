import { IsIn, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateCashMovementDto {
  @IsIn(['PAY_IN', 'PAY_OUT'])
  type!: 'PAY_IN' | 'PAY_OUT';

  // Tope alineado a la columna Decimal(10,2) — sin esto un monto gigante
  // desbordaba la columna y tiraba 500.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}
