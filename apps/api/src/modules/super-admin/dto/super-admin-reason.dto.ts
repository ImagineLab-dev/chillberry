import { IsString, Length } from 'class-validator';

/**
 * Motivo obligatorio de una acción sensible del super-admin (impersonar,
 * resetear la contraseña de un dueño). Queda en la auditoría: sin un porqué,
 * un log de "entró como el cliente X" no sirve para nada.
 */
export class SuperAdminReasonDto {
  @IsString()
  @Length(1, 300)
  reason!: string;
}
