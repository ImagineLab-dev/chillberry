import { ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ANY_ROLE_KEY } from '../decorators/any-role.decorator';
import type { AuthenticatedUser } from '../../modules/auth/auth.types';
import type { UserRole } from '@chillberry/domain';

/**
 * Autorización por rol. Corre después de JwtAuthGuard (ambos registrados
 * globalmente vía APP_GUARD, en ese orden).
 *
 * **DENY BY DEFAULT**: un handler sin `@Roles(...)`, `@AnyRole()` ni
 * `@Public()` devuelve 403.
 *
 * Antes era fail-open (sin `@Roles` pasaba cualquier autenticado) y el
 * resultado fue que quedaron abiertos sin que nadie lo notara: los 7 endpoints
 * de caja (abrir/cerrar caja, descuentos, cobrar), 5 de mesero, los 4 de
 * pedidos y el dashboard. Un REPARTIDOR podía cobrar, cancelar pedidos y ver
 * la facturación del día.
 *
 * El modelo opt-in falla en silencio: olvidarse de un decorador no rompe nada
 * visible y el agujero vive hasta que alguien lo audita. Deny-by-default falla
 * ruidosamente en el primer request, y abrir un endpoint pasa a ser un acto
 * explícito (`@AnyRole()`) que queda en el diff.
 */
@Injectable()
export class RolesGuard {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    const allowAnyRole = this.reflector.getAllAndOverride<boolean>(ANY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowAnyRole) {
      if (!user) throw new ForbiddenException('No tenés permiso para realizar esta acción');
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      // Un handler sin decorar es un bug de programación, no un intento de
      // acceso indebido: se loguea fuerte para que salte en el primer request
      // en vez de quedar como un 403 misterioso.
      this.logger.error(
        `${context.getClass().name}.${context.getHandler().name} no declara @Roles(), @AnyRole() ni @Public() — denegado por defecto.`,
      );
      throw new ForbiddenException('No tenés permiso para realizar esta acción');
    }

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('No tenés permiso para realizar esta acción');
    }
    return true;
  }
}
