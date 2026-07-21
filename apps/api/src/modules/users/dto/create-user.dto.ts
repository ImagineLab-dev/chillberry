import { USER_ROLE, type UserRole } from '@chillberry/domain';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';

const STAFF_ROLES = [USER_ROLE.Admin, USER_ROLE.Waiter, USER_ROLE.Kitchen, USER_ROLE.Cashier, USER_ROLE.Driver];

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsStrongPassword()
  password!: string;

  // OWNER y SUPER_ADMIN no se crean por acá — OWNER nace con /auth/register,
  // SUPER_ADMIN queda fuera de alcance de Fase 0 (staff interno de Chillberry).
  @IsEnum(USER_ROLE)
  @IsIn(STAFF_ROLES)
  role!: UserRole;

  @IsOptional()
  @IsString()
  @Length(6, 30)
  phone?: string;

  /**
   * Sucursal donde trabaja. Sin ella, el empleado ve y opera sobre TODOS los
   * locales del restaurante — que es lo que pasaba antes de que esto existiera.
   * El service la exige para los roles de local (ver UsersService.create).
   */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
