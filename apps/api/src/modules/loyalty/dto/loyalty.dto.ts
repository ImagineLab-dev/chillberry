import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateProgramDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Cuánto hay que gastar para ganar 1 punto. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  earnPer?: number;

  /** Cuánto vale cada punto al canjear. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  pointValue?: number;
}

export class RedeemDto {
  @IsString()
  @Length(1, 30)
  phone!: string;

  @IsString()
  @Length(1, 40)
  orderId!: string;

  @IsInt()
  @Min(1)
  points!: number;
}

export class AdjustPointsDto {
  @IsString()
  @Length(6, 30)
  phone!: string;

  /** Positivo suma, negativo resta. El saldo nunca queda negativo. */
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  delta!: number;

  @IsString()
  @Length(3, 300)
  note!: string;
}
