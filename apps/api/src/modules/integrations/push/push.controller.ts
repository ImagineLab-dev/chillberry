import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { USER_ROLE } from '@chillberry/domain';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { strictThrottle } from '../../../common/security/throttle.util';
import { loadEnv } from '../../../config/env';
import { PrismaService } from '../../../prisma/prisma.service';
import { PushService } from './push.service';
import type { AuthenticatedUser } from '../../auth/auth.types';

class SuscribirDto {
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}

@Controller('push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Clave pública para que el navegador pueda suscribirse.
   *
   * Es pública por definición (va dentro del JavaScript del cliente); la
   * privada nunca sale del servidor. Se sirve por endpoint y no como
   * `NEXT_PUBLIC_*` para poder rotarla sin reconstruir el front.
   */
  @Public()
  @Get('clave-publica')
  clavePublica() {
    return { key: loadEnv().VAPID_PUBLIC_KEY ?? null };
  }

  /**
   * El COMENSAL se suscribe desde su página de seguimiento.
   *
   * Público, y la identidad sale del `trackingToken`: es el mismo modelo que ya
   * usa el seguimiento — quien tiene el link es el que hizo el pedido. El
   * teléfono NO viene del cuerpo, se lee del delivery: si el cliente lo
   * mandara, cualquiera podría suscribirse a los avisos de otro.
   */
  @Public()
  @Throttle(strictThrottle(20))
  @Post('suscribir/seguimiento/:token')
  async suscribirSeguimiento(@Param('token') token: string, @Body() dto: SuscribirDto) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { trackingToken: token },
      select: { tenantId: true, order: { select: { customerPhone: true } } },
    });
    // Respuesta uniforme: no confirma si el token existe.
    if (!delivery?.order?.customerPhone) return { ok: true };

    return this.push.suscribir({
      tenantId: delivery.tenantId,
      phone: delivery.order.customerPhone,
      ...dto,
    });
  }

  /**
   * El PERSONAL (repartidor, mozo, cocina, caja, dueño) se suscribe con su
   * sesión.
   *
   * Se listan TODOS los roles a propósito: `RolesGuard` es deny-by-default, así
   * que un endpoint sin `@Roles` rechaza a cualquiera con 403 aunque esté
   * autenticado. Recibir avisos no es un permiso privilegiado — le sirve a
   * cualquiera que trabaje en el local.
   */
  @Roles(
    USER_ROLE.Owner,
    USER_ROLE.Admin,
    USER_ROLE.Waiter,
    USER_ROLE.Kitchen,
    USER_ROLE.Cashier,
    USER_ROLE.Driver,
  )
  @Throttle(strictThrottle(20))
  @Post('suscribir')
  async suscribir(@Body() dto: SuscribirDto, @CurrentUser() user: AuthenticatedUser) {
    const perfil = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { phone: true },
    });
    // Sin teléfono cargado no hay a quién dirigir el aviso. Se responde ok para
    // no romper la pantalla; el dueño lo resuelve cargándole el teléfono.
    if (!perfil?.phone) return { ok: true, sinTelefono: true };

    return this.push.suscribir({
      tenantId: user.tenantId,
      phone: perfil.phone,
      userId: user.id,
      ...dto,
    });
  }
}
