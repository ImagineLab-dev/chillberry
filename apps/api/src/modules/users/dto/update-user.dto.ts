import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { USER_ROLE, type UserRole } from '@chillberry/domain';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';

// Roles asignables por edición. Excluye SUPER_ADMIN a nivel validación: sin esto
// un OWNER podía hacer `PATCH /users/:id {role:'SUPER_ADMIN'}` y, tras loguearse,
// tomar control de TODOS los tenants (panel super-admin). OWNER sí se permite
// para no romper la edición del propio dueño; crear un segundo OWNER lo frena el
// service (UsersService.update). SUPER_ADMIN nunca se asigna por esta vía.
const ASSIGNABLE_ROLES = [
  USER_ROLE.Owner,
  USER_ROLE.Admin,
  USER_ROLE.Waiter,
  USER_ROLE.Kitchen,
  USER_ROLE.Cashier,
  USER_ROLE.Driver,
];

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsEnum(USER_ROLE)
  @IsIn(ASSIGNABLE_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @Length(6, 30)
  phone?: string;

  // Reset de contraseña por el owner/admin (staff que olvidó su clave). Se
  // hashea en el service y se revocan las sesiones activas del usuario.
  @IsOptional()
  @IsStrongPassword()
  password?: string;
}
