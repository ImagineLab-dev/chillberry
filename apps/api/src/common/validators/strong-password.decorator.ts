import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Regla de contraseña compartida por todos los caminos que setean una clave
 * (register, alta de staff, alta de repartidor, reset). Balance entre seguridad
 * y no-frustrar: mínimo 8, al menos una letra y un número — corta las triviales
 * ("12345678", "aaaaaaaa") sin exigir símbolos ni mayúsculas. El máximo 72 es el
 * límite de bytes de argon2/bcrypt.
 */
export function IsStrongPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' }),
    MaxLength(72),
    Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
      message: 'La contraseña debe incluir al menos una letra y un número',
    }),
  );
}
