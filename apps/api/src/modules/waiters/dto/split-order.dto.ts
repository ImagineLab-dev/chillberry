import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { BILL_SPLIT_MODE, type BillSplitMode } from '@chillberry/domain';

export class SplitPartDto {
  @IsString()
  @Length(1, 80)
  label!: string;

  // BY_PERSON: monto directo. BY_ITEM: se ignora, se calcula server-side
  // sumando los items asignados — nunca se confía en un monto mandado por
  // el cliente para ese modo.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  itemIds?: string[];
}

export class SplitOrderDto {
  @IsEnum(BILL_SPLIT_MODE)
  mode!: BillSplitMode;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => SplitPartDto)
  parts!: SplitPartDto[];
}
