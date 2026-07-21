import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { strictThrottle } from '../../common/security/throttle.util';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PublicMenuService } from './public-menu.service';
import { CreateGuestOrderDto } from './dto/create-guest-order.dto';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';

/**
 * Todo lo que ve/hace un cliente anónimo — SIN auth, como `TrackingController`
 * (Fase 5). Dos superficies públicas:
 *  - `branch/:slug` → carta COMPARTIBLE de una sucursal (Instagram/los avisos),
 *    con pedido de delivery/retiro y pago al recibir.
 *  - `:qrToken` → carta del QR de una MESA, con pedido self-service DINE_IN.
 * Ver `PublicMenuService` para el detalle de cada operación.
 */
@Controller('public/menu')
export class PublicMenuController {
  constructor(private readonly publicMenu: PublicMenuService) {}

  // Rutas `branch/*` y `store/*` primero: son de dos segmentos y no chocan con
  // el `:qrToken` de un segmento, pero se registran antes por prolijidad.
  @Public()
  @Throttle(strictThrottle(30))
  @Get('store/:subdomain')
  getStoreBySubdomain(@Param('subdomain') subdomain: string) {
    return this.publicMenu.getStoreBySubdomain(subdomain);
  }

  @Public()
  @Throttle(strictThrottle(30))
  @Get('branch/:slug')
  getByBranchSlug(@Param('slug') slug: string) {
    return this.publicMenu.getByBranchSlug(slug);
  }

  // Endpoint público de escritura (crea un Order real): throttle estricto para
  // que nadie automatice pedidos falsos contra la sucursal.
  @Public()
  @Throttle(strictThrottle(10))
  @Post('branch/:slug/order')
  createPublicOrder(
    @Param('slug') slug: string,
    @Body() dto: CreatePublicOrderDto,
    @Req() req: Request,
  ) {
    return this.publicMenu.createPublicOrder(slug, dto, req.ip ?? null);
  }

  @Public()
  @Throttle(strictThrottle(30))
  @Get(':qrToken')
  getByQrToken(@Param('qrToken') qrToken: string) {
    return this.publicMenu.getByQrToken(qrToken);
  }

  // Throttle más estricto que el default: es un endpoint público de
  // escritura (crea un Order real) — sin esto, alguien podría automatizar
  // pedidos falsos contra una mesa.
  @Public()
  @Throttle(strictThrottle(10))
  @Post(':qrToken/order')
  createGuestOrder(
    @Param('qrToken') qrToken: string,
    @Body() dto: CreateGuestOrderDto,
    @Req() req: Request,
  ) {
    return this.publicMenu.createGuestOrder(qrToken, dto, req.ip ?? null);
  }

  // Cuenta EN VIVO de la mesa por su QR — el comensal ve el acumulado sin pedir.
  @Public()
  @Throttle(strictThrottle(30))
  @Get(':qrToken/account')
  getTableAccount(@Param('qrToken') qrToken: string) {
    return this.publicMenu.getTableAccount(qrToken);
  }

  @Public()
  @Throttle(strictThrottle(30))
  @Get('orders/:orderId/status')
  getOrderStatus(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.publicMenu.getOrderStatus(orderId);
  }
}
