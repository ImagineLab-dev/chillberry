import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../modules/auth/auth.types';
import { sucursalParaFiltrar } from '../security/branch-scope';

/**
 * Resuelve por qué sucursal filtrar, ya con el aislamiento aplicado.
 *
 *   @Get('pending')
 *   listPending(@BranchScope() branchId?: string) { ... }
 *
 * Reemplaza a `@Query('branchId')`. Devuelve:
 * - la sucursal DEL EMPLEADO si está atado a una — ignorando lo que haya pedido;
 * - lo que pidió, si ve todo el restaurante (el dueño);
 * - `undefined` si ve todo y no pidió nada.
 *
 * Es un decorador y no una comprobación suelta en cada handler a propósito: son
 * 22 endpoints, y el modo de fallo de olvidarse en uno es silencioso —
 * devuelve datos de más, sin error ni 403. Acá el aislamiento viaja pegado al
 * parámetro: si el parámetro está, el filtro está.
 *
 * De paso descarta cualquier `branchId` que no sea un string. Express parsea
 * `?branchId[gt]=` como objeto, y ese objeto llegaba a Prisma interpretado como
 * operador de comparación, esquivando el filtro.
 */
export const BranchScope = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  const pedido = req.query?.branchId;
  const limpio = typeof pedido === 'string' && pedido.length > 0 ? pedido : undefined;

  // Sin usuario (no debería pasar: estas rutas van detrás del guard) se
  // devuelve lo pedido, que es el comportamiento previo. El guard es quien
  // corta, no esto.
  if (!req.user) return limpio;

  return sucursalParaFiltrar(req.user, limpio);
});
