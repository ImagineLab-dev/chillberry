import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module';
import { TurnstileModule } from '../../common/turnstile/turnstile.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { CouponsModule } from '../coupons/coupons.module';
import { MenuController } from './menu.controller';
import { PublicMenuController } from './public-menu.controller';
import { MenuService } from './menu.service';
import { CombosService } from './combos.service';
import { PublicMenuService } from './public-menu.service';
import { ModifiersService } from './modifiers.service';
import { ModifierAdminService } from './modifier-admin.service';

@Module({
  // DeliveryModule: el pedido público de delivery reusa DeliveryService para
  // crear el Delivery y disparar la auto-asignación real de repartidor.
  // CouponsModule: validar/canjear el cupón que tipea el cliente en el checkout.
  imports: [KitchenModule, TurnstileModule, DeliveryModule, CouponsModule],
  controllers: [MenuController, PublicMenuController],
  providers: [MenuService, CombosService, PublicMenuService, ModifiersService, ModifierAdminService],
  // ModifiersService se exporta para OrdersService: los dos caminos de creación
  // de pedido tienen que resolver precios con la MISMA lógica.
  exports: [MenuService, ModifiersService],
})
export class MenuModule {}
