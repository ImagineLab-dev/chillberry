import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ORDER_TYPE, type OrderType } from '@chillberry/domain';

export class CreateOrderItemDto {
  @IsUUID()
  menuItemId!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;

  /** IDs de las opciones elegidas. El precio lo resuelve el servidor. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  modifierOptionIds?: string[];
}

export class CreateOrderDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsOptional()
  @IsEnum(ORDER_TYPE)
  type?: OrderType;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  customerName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
