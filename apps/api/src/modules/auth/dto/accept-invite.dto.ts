import { IsString, Length } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';

/**
 * Aceptar una invitación al equipo: el empleado llega por el link del mail
 * (`/invitacion/<token>`) y fija su propia contraseña. El token es un
 * `randomBytes(24).toString('hex')` = 48 hex; se acepta un rango holgado para
 * no romper si algún día cambia el largo del token.
 */
export class AcceptInviteDto {
  @IsString()
  @Length(24, 128)
  token!: string;

  // Misma exigencia que el alta y la recuperación: la clave que el empleado
  // elige no puede ser más débil de lo que el registro acepta.
  @IsStrongPassword()
  password!: string;
}
