import { ForbiddenException } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import type { AuthenticatedUser } from '../../modules/auth/auth.types';

/**
 * Aislamiento por SUCURSAL, el segundo nivel después del de tenant.
 *
 * El de tenant lo resuelve `TenantPrismaService` inyectando `tenantId` sin que
 * nadie tenga que acordarse. Este no se puede resolver igual: muchos modelos no
 * tienen `branchId` propio (un `Payment` cuelga de un `Order`), así que la
 * pertenencia hay que comprobarla donde se sabe a qué sucursal pertenece cada
 * cosa. Por eso es explícito: se ve en el código quién lo aplica y quién no.
 *
 * La regla:
 * - **OWNER** (dueño): ve y opera sobre TODOS sus locales.
 * - **Todos los demás** (ADMIN/gerente, mozo, cajero, cocina): sólo el suyo.
 * - Usuario sin sucursal asignada: acceso total. Es lo que mantiene andando a
 *   las cuentas creadas antes de que esto existiera — asignarles sucursal es un
 *   paso explícito, no un efecto colateral de desplegar.
 */

/** ¿Este usuario ve todo el restaurante, o está atado a un local? */
export function veTodasLasSucursales(user: Pick<AuthenticatedUser, 'role' | 'branchId'>): boolean {
  return user.role === USER_ROLE.Owner || user.role === USER_ROLE.SuperAdmin || !user.branchId;
}

/**
 * Falla si el usuario está atado a un local y el recurso es de otro.
 *
 * Se llama con el `branchId` REAL del recurso (leído de la base), no con el que
 * mandó el cliente: validar contra el input del atacante no valida nada.
 */
export function assertPuedeUsarSucursal(
  user: Pick<AuthenticatedUser, 'role' | 'branchId'>,
  branchIdDelRecurso: string | null | undefined,
): void {
  if (veTodasLasSucursales(user)) return;
  if (branchIdDelRecurso && branchIdDelRecurso === user.branchId) return;

  // Mensaje deliberadamente vago: confirmar "existe pero es de otra sucursal"
  // le sirve al que está tanteando. Que no se distinga de un recurso
  // inexistente.
  throw new ForbiddenException('No tenés acceso a este recurso');
}

/**
 * Devuelve la sucursal por la que hay que filtrar un listado.
 *
 * Cierra dos agujeros de un saque:
 *
 * 1. Un empleado atado a un local que pide `?branchId=<otro>` recibe igual lo
 *    suyo — no un error que le confirme que el otro existe.
 * 2. **Omitir el parámetro**. Sin esto, `branchId: undefined` desaparece del
 *    `where` de Prisma y la consulta devuelve TODO el restaurante. Es el modo
 *    de fallo más traicionero: no hay error, no hay 403, sólo aparecen de más.
 */
export function sucursalParaFiltrar(
  user: Pick<AuthenticatedUser, 'role' | 'branchId'>,
  branchIdPedido?: string | null,
): string | undefined {
  if (!veTodasLasSucursales(user)) return user.branchId!;
  return branchIdPedido ?? undefined;
}
