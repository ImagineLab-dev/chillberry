import { IsEnum } from 'class-validator';
import { KITCHEN_TASK_STATUS, type KitchenTaskStatus } from '@chillberry/domain';

export class UpdateTaskStatusDto {
  @IsEnum(KITCHEN_TASK_STATUS)
  status!: KitchenTaskStatus;
}
