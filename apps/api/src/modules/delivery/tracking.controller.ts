import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { strictThrottle } from '../../common/security/throttle.util';
import { DeliveryService } from './delivery.service';
import { RateDeliveryDto } from './dto/rate-delivery.dto';

/**
 * Endpoint público de tracking — el modelo de seguridad es "quien tiene el
 * link (deliveryId) puede ver el estado", igual que un tracking de
 * Uber Eats/PedidosYa. Nunca expone teléfono ni ubicación si el estado no
 * es rastreable o el repartidor está offline (ver DeliveryService.getPublicTracking).
 */
@Controller('track')
export class TrackingController {
  constructor(private readonly delivery: DeliveryService) {}

  @Public()
  @Throttle(strictThrottle(30))
  @Get(':id')
  track(@Param('id', ParseUUIDPipe) id: string) {
    return this.delivery.getPublicTracking(id);
  }

  // El cliente califica al repartidor una vez entregado. Escritura pública →
  // throttle estricto.
  @Public()
  @Throttle(strictThrottle(10))
  @Post(':id/rate')
  rate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RateDeliveryDto) {
    return this.delivery.ratePublicDelivery(id, dto.rating, dto.comment);
  }
}
