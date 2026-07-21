import { IsUUID } from 'class-validator';

export class ChangePlanDto {
  @IsUUID()
  planId!: string;
}
