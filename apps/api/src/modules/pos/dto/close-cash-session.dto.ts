import { IsNumber, Min } from 'class-validator';

export class CloseCashSessionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedCash!: number;
}
