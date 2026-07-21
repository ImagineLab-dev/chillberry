import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** Nuevo orden de los productos de una sucursal: `sortOrder` = posición en la lista. */
export class ReorderItemsDto {
  @IsUUID()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  orderedIds!: string[];
}
