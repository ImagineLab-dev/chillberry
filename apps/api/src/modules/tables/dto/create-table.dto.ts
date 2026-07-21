import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreateTableDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @Length(1, 20)
  code!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;
}
