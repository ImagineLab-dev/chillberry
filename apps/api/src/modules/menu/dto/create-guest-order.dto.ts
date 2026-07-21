import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GuestOrderLineDto {
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

export class CreateGuestOrderDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  customerName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  customerPhone?: string;

  /** Nota general del pedido ("somos alérgicos al maní"), aparte de las de
   *  cada ítem. Espeja a `CreateOrderDto.notes` del camino de staff. */
  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GuestOrderLineDto)
  items!: GuestOrderLineDto[];

  @IsString()
  @Length(1, 4000)
  turnstileToken!: string;
}
