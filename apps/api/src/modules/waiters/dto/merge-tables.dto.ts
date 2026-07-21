import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class MergeTablesDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  tableIds!: string[];
}
