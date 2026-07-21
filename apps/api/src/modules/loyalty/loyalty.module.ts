import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  // PaymentsModule lo importa para acreditar puntos al cerrar un pedido.
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
