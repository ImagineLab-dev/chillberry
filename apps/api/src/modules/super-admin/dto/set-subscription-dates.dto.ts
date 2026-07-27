import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';

/**
 * Fijar/extender a mano las fechas de la suscripción de un tenant (fin de
 * prueba y/o próxima renovación). Es la herramienta del super-admin para dar
 * más tiempo: extender una prueba, regalar días, o dejar un demo con pista larga.
 *
 * Ambas fechas son opcionales pero se exige al menos una (se valida en el
 * service). Se aceptan como ISO-8601; el service las convierte a Date.
 */
export class SetSubscriptionDatesDto {
  /** Nueva fecha de fin de prueba (ISO-8601), o se omite para no tocarla. */
  @IsOptional()
  @IsISO8601()
  trialEndsAt?: string;

  /** Nueva fecha de renovación / hasta cuándo tiene acceso pago (ISO-8601). */
  @IsOptional()
  @IsISO8601()
  renewalDate?: string;

  /** Motivo — queda en la auditoría (obligatorio: mueve el acceso del cliente). */
  @IsString()
  @Length(1, 300)
  reason!: string;
}
