import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module';
// Por ModifiersService: la resolución de precios con extras tiene que ser la
// misma acá que en el pedido por QR. MenuModule no importa OrdersModule, así
// que no hay ciclo.
import { MenuModule } from '../menu/menu.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [KitchenModule, MenuModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
