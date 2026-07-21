import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IntegrationsModule } from '../integrations/integrations.module';
import { BillingModule } from '../billing/billing.module';
import { DeliveryController } from './delivery.controller';
import { TrackingController } from './tracking.controller';
import { DeliveryService } from './delivery.service';
import { DriversService } from './drivers.service';
import { ZonesService } from './zones.service';
import { DeliveryGateway } from './delivery.gateway';
import { RoutingAdapter } from './routing.adapter';
import { DeliveryReassignService } from './delivery-reassign.service';

@Module({
  // BillingModule: un repartidor es un User y consume cupo del plan
  // (DriversService.register lo valida).
  imports: [JwtModule.register({}), IntegrationsModule, BillingModule],
  controllers: [DeliveryController, TrackingController],
  providers: [DeliveryService, DriversService, ZonesService, DeliveryGateway, DeliveryReassignService, RoutingAdapter],
  exports: [DeliveryService, DriversService],
})
export class DeliveryModule {}
