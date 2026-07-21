import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module';
import { WaitersController } from './waiters.controller';
import { WaitersService } from './waiters.service';

@Module({
  // KitchenModule exporta KitchenGateway → para avisar a la CAJA por socket
  // cuando una mesa pide la cuenta (`emitToCash`).
  imports: [KitchenModule],
  controllers: [WaitersController],
  providers: [WaitersService],
  exports: [WaitersService],
})
export class WaitersModule {}
