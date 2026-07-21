import { SetMetadata } from '@nestjs/common';

export const ANY_ROLE_KEY = 'anyRole';

/**
 * Marca un endpoint como accesible por CUALQUIER usuario autenticado, sin
 * importar el rol.
 *
 * Existe porque `RolesGuard` es deny-by-default: un handler sin `@Roles(...)`
 * ni `@AnyRole()` devuelve 403. Antes era al revés (sin `@Roles` pasaba
 * cualquiera) y eso dejó abiertos, sin que nadie lo notara, los endpoints de
 * caja, mesero, pedidos y dashboard — un repartidor podía cobrar o cancelar
 * pedidos.
 *
 * La diferencia con el modelo viejo es que ahora **olvidarse** falla cerrado y
 * se ve en el acto, mientras que abrir un endpoint es un acto explícito que
 * queda escrito en el código y se revisa en el PR.
 */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);
