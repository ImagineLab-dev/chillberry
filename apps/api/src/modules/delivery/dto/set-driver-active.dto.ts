import { IsBoolean } from 'class-validator';

/** Baja/reactivación de un repartidor desde el admin. */
export class SetDriverActiveDto {
  @IsBoolean()
  active!: boolean;
}
