import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * Override de límites por-tenant que fija el super-admin (más sucursales/usuarios
 * que el plan, para un cliente puntual). Por campo:
 *   - ausente (undefined) → no tocar,
 *   - `null` → quitar el override y volver al límite del plan,
 *   - número → fijar ese override.
 *
 * `@IsOptional` ignora la validación cuando el valor es null/undefined, así que
 * un `null` pasa (limpia) y un número se valida. El service exige que venga al
 * menos uno de los dos + motivo.
 */
export class SetTenantLimitsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxBranchesOverride?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  maxUsersOverride?: number | null;

  @IsString()
  @Length(1, 300)
  reason!: string;
}
