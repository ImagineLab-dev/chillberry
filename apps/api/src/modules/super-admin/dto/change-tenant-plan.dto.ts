import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class ChangeTenantPlanDto {
  @IsUUID()
  planId!: string;

  /// Opcional a diferencia del `reason` de la suspensión: cambiar de plan no
  /// corta el servicio del cliente, así que no vale la pena frenar la
  /// operación por no tener el motivo. Si viene, se guarda en la auditoría.
  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;
}
