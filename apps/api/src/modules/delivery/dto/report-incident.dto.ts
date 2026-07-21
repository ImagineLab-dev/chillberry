import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { INCIDENT_TYPE, type IncidentType } from '@chillberry/domain';

export class ReportIncidentDto {
  @IsEnum(INCIDENT_TYPE)
  type!: IncidentType;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;
}
