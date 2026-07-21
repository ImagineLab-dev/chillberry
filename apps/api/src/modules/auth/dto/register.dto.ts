import { IsEmail, IsIn, IsString, Length, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';
import { DLOCAL_COUNTRIES } from '@chillberry/domain';

const COUNTRY_CODES = DLOCAL_COUNTRIES.map((c) => c.countryCode);

export class RegisterDto {
  @IsString()
  @Length(2, 120)
  tenantName!: string;

  @IsString()
  @Length(2, 120)
  ownerName!: string;

  @IsEmail()
  email!: string;

  @IsStrongPassword()
  password!: string;

  // Determina tanto `Tenant.countryCode` como `Tenant.currency` (se deriva
  // del mismo país vía `findDlocalCountry` en el service — un solo campo
  // para elegir, no dos, ya que en la práctica van siempre juntos).
  @IsString()
  @IsIn(COUNTRY_CODES)
  countryCode: string = 'PY';

  @IsString()
  @MinLength(1)
  turnstileToken!: string;
}
