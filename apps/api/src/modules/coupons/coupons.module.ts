import { Module } from '@nestjs/common';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  controllers: [CouponsController],
  providers: [CouponsService],
  // Exportado para el canje: PublicMenuService (checkout de la carta) y
  // PosService (cupón presentado en caja) lo usan.
  exports: [CouponsService],
})
export class CouponsModule {}
