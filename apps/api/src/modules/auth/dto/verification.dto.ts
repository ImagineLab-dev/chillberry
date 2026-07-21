import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';

/** Los códigos son 6 dígitos exactos: cualquier otra cosa se rechaza sin tocar la base. */
const CODIGO = { length: 6, regex: /^\d{6}$/ };

export class VerifySignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(CODIGO.length, CODIGO.length)
  @Matches(CODIGO.regex, { message: 'El código son 6 dígitos' })
  code!: string;
}

export class RequestPasswordResetDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  turnstileToken!: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(CODIGO.length, CODIGO.length)
  @Matches(CODIGO.regex, { message: 'El código son 6 dígitos' })
  code!: string;

  // Misma exigencia que el alta: recuperar la cuenta no puede ser una puerta
  // para poner una contraseña más débil de la que el registro acepta.
  @IsStrongPassword()
  password!: string;
}
