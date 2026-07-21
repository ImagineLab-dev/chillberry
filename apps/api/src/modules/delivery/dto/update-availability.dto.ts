import { IsEnum } from 'class-validator';
import { DRIVER_AVAILABILITY, type DriverAvailability } from '@chillberry/domain';

export class UpdateAvailabilityDto {
  @IsEnum(DRIVER_AVAILABILITY)
  availability!: DriverAvailability;
}
