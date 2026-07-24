import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { USER_ROLE } from '@chillberry/domain';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { estadoDeBloqueo, type MotivoBloqueo } from '../../modules/billing/subscription-estado';
import type { AuthenticatedUser } from '../../modules/auth/auth.types';

/**
 * SOLO LECTURA cuando la suscripción venció (ver subscription-estado.ts).
 *
 * Tercer guard global (después de JwtAuthGuard y RolesGuard): con la prueba
 * vencida / cancelación cumplida / suspensión, TODA escritura del staff
 * (POST/PATCH/PUT/DELETE) devuelve **402** con `code: SUBSCRIPTION_EXPIRED`.
 * Las lecturas pasan: el dueño ve sus datos intactos — le mostramos lo que
 * recupera pagando, no una pantalla vacía.
 *
 * Exenciones (por qué cada una):
 *  - GET/HEAD/OPTIONS       → solo lectura ES eso.
 *  - @Public                → clientes finales y webhooks; los pedidos públicos
 *                             tienen su propio bloqueo con mensaje neutro en
 *                             public-menu (acá no hay JWT del que sacar tenant).
 *  - /api/auth              → hay que poder ENTRAR para pagar (login/refresh).
 *  - /api/billing           → el camino de pago es la salida del bloqueo.
 *  - /api/webhooks          → la confirmación del pago llega por acá.
 *  - SUPER_ADMIN            → staff interno, no es un tenant.
 *
 * Costo: UNA query indexada (unique por tenantId) por escritura. Sin cache a
 * propósito: pagar desbloquea al instante y el guard nunca miente por datos
 * viejos. Si algún día pesa, cachear acá con TTL corto.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
    if (
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/billing') ||
      req.path.startsWith('/api/webhooks')
    ) {
      return true;
    }

    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (!user || user.role === USER_ROLE.SuperAdmin) return true;

    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId: user.tenantId },
      select: { status: true, trialEndsAt: true, cancelledAt: true, renewalDate: true },
    });
    const estado = estadoDeBloqueo(sub);
    if (!estado.bloqueada) return true;

    throw new HttpException(
      {
        statusCode: 402,
        code: 'SUBSCRIPTION_EXPIRED',
        motivo: estado.motivo,
        message: MENSAJE[estado.motivo!],
      },
      402,
    );
  }
}

const MENSAJE: Record<MotivoBloqueo, string> = {
  TRIAL_VENCIDO:
    'Tu prueba gratuita terminó — tus datos están intactos, pero para seguir operando hay que activar la suscripción.',
  CANCELADA:
    'Tu suscripción terminó — tus datos están intactos; reanudala para seguir operando.',
  SUSPENDIDA: 'Tu suscripción está suspendida. Escribinos a soporte@chillberry.app.',
};
