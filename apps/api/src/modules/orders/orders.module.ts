import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module';
// Por ModifiersService: la resolución de precios con extras tiene que ser la
// misma acá que en el pedido por QR. MenuModule no importa OrdersModule, así
// que no hay ciclo.
import { MenuModule } from '../menu/menu.module';
import { InventoryModule } from '../inventory/inventory.module';
// Por PaymentsService.checkAndCompleteOrder: cerrar un pedido de total 0 por el
// mismo camino real (mesa/factura/stock/puntos). PaymentsModule no importa
// OrdersModule, así que no hay ciclo.
import { PaymentsModule } from '../payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [KitchenModule, MenuModule, InventoryModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
