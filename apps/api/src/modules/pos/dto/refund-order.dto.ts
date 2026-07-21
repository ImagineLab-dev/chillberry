import { IsNumber, IsString, Length, Max, Min } from 'class-validator';

/** Reembolso (total o parcial) de un pedido ya cobrado. */
export class RefundOrderDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999)
  amount!: number;

  @IsString()
  @Length(3, 300)
  reason!: string;
}
