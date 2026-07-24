import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { USER_ROLE, type OrderStatus } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { AddOrderItemsDto } from './dto/add-order-items.dto';
import { UpdateOrderItemDto } from './dto/update-order-item.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // El mesero arma pedidos desde `app/waiter/page.tsx`; admin/orders también.
  // El cajero TAMBIÉN crea pedidos: la venta de mostrador ("Nueva venta" en
  // `app/pos`) es un pedido sin mesa que se arma y se cobra en la misma caja.
  // Sin esto, un mostrador/comida rápida obligaba a saltar a otra pantalla para
  // arrancar la venta. El pedido queda con `waiterId` = quien lo cargó.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter, USER_ROLE.Cashier)
  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    // Se pasa el usuario entero (no sólo el id): el service usa su rol+sucursal
    // para impedir que un empleado atado a un local cree pedidos en otro.
    return this.orders.create(dto, { id: user.id, role: user.role, branchId: user.branchId });
  }

  // Listado transversal de la sucursal (incluye totales de todos los pedidos):
  // solo `app/admin/orders/page.tsx`. El mesero ve su pedido activo por id y
  // el cajero los pendientes por /pos/orders/pending.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get()
  list(
    @BranchScope() branchId?: string,
    @Query('status') status?: OrderStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.orders.list({
      branchId,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    // Con control de sucursal: el UUID de un pedido ajeno no alcanza para verlo.
    return this.orders.getForActor(id, { id: user.id, role: user.role, branchId: user.branchId });
  }

  // Segunda ronda a una mesa abierta ("agregame un postre"). Mismo trío que
  // crea pedidos: el mesero lo hace desde `app/waiter`.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
  @Post(':id/items')
  addItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddOrderItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.addItems(id, dto.items, { id: user.id, role: user.role, branchId: user.branchId });
  }

  // Editar la cantidad de un ítem ya enviado ("eran 2 no 3"). Mismo trío que
  // agrega ítems: lo usa el mesero desde `app/waiter`.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateOrderItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateItemQuantity(id, itemId, dto.quantity, { id: user.id, role: user.role, branchId: user.branchId });
  }

  // Quitar un ítem mal disparado sin cancelar todo el pedido.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.removeItem(id, itemId, { id: user.id, role: user.role, branchId: user.branchId });
  }

  // Incluye CANCELLED: un solo endpoint para todas las transiciones, así que
  // el rol más laxo que lo tenga puede cancelar cualquier pedido. No se puede
  // separar "avanzar" de "cancelar" sin partir el endpoint, y el único caller
  // es `app/admin/orders/page.tsx` → se queda en OWNER/ADMIN. La cocina avanza
  // sus tareas por /kitchen/tasks/:id/status, que ya está acotado a KITCHEN.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateStatus(id, dto.status, { id: user.id, role: user.role, branchId: user.branchId }, dto.reason);
  }
}
