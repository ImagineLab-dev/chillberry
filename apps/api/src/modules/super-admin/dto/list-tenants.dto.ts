import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';
import { SUBSCRIPTION_STATUS, type SubscriptionStatus } from '@chillberry/domain';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../super-admin.constants';

const STATUSES = Object.values(SUBSCRIPTION_STATUS);

export class ListTenantsDto {
  // `@Type(() => Number)` es obligatorio: los query params llegan SIEMPRE como
  // string y el ValidationPipe global corre con
  // `enableImplicitConversion: false` (ver main.ts) — sin esto, `@IsInt`
  // rechaza "2" y todo listado paginado da 400.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: SubscriptionStatus;
}
