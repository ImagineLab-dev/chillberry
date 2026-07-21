import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SYSTEM_TENANT_SLUG } from './super-admin.constants';

/**
 * Blindaje de aislamiento (defensa en profundidad): un SUPER_ADMIN solo vale si
 * pertenece al tenant sistema (`smartia-system`). El diseño ya asume esto (ver
 * super-admin.constants) pero no estaba ENFORCED en runtime — se sostenía solo
 * porque no hay forma de crear un SUPER_ADMIN en otro tenant (el `@IsIn` del
 * UpdateUserDto + el chequeo del service lo bloquean). Este guard lo hace
 * explícito: aunque por un bug apareciera una fila SUPER_ADMIN en un tenant
 * cualquiera, no podría entrar al panel que cruza tenants.
 *
 * Corre DESPUÉS de JwtAuthGuard + RolesGuard (globales) — el user ya está
 * autenticado y con rol SUPER_ADMIN cuando llega acá. El id del tenant sistema
 * se resuelve una vez y se cachea (el guard es singleton).
 */
@Injectable()
export class SystemTenantGuard implements CanActivate {
  private systemTenantId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>().user;
    if (!user) throw new ForbiddenException('No tenés permiso para realizar esta acción');

    if (this.systemTenantId == null) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { slug: SYSTEM_TENANT_SLUG },
        select: { id: true },
      });
      this.systemTenantId = tenant?.id ?? null;
    }

    if (!this.systemTenantId || user.tenantId !== this.systemTenantId) {
      throw new ForbiddenException('Acceso de super-admin restringido al tenant sistema');
    }
    return true;
  }
}
