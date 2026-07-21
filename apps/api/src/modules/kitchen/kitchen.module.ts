import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { IntegrationsModule } from '../integrations/integrations.module';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { KitchenGateway } from './kitchen.gateway';

@Module({
  // IntegrationsModule: para avisarle al cliente cuando el pedido
  // pasa a "listo" (NotificationsService).
  imports: [JwtModule.register({}), IntegrationsModule],
  controllers: [KitchenController],
  providers: [KitchenService, KitchenGateway],
  // KitchenGateway se exporta para que otros módulos (p.ej. WaitersModule)
  // puedan emitir a la room de caja por sucursal — ver `emitToCash`.
  exports: [KitchenService, KitchenGateway],
})
export class KitchenModule {}
