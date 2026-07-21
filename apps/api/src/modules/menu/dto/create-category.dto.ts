import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CreateMenuCategoryDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
