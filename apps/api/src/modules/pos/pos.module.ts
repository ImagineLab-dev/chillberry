import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  // CouponsModule: validar/canjear el cupón que el cliente presenta en caja.
  imports: [PaymentsModule, CouponsModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
