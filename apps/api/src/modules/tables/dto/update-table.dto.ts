import { TABLE_STATUS, type TableStatus } from '@chillberry/domain';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @Length(1, 20)
  code?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

  @IsOptional()
  @IsEnum(TABLE_STATUS)
  status?: TableStatus;

  // Soft-delete: desactivar/reactivar la mesa (la saca del mapa del mesero).
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
