import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PurchasingService } from './purchasing.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

// Compras es del dueño/admin (toca costos y stock). El mesero/cajero no entran.
@Roles(USER_ROLE.Owner, USER_ROLE.Admin)
@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  // ---- Proveedores ----

  @Get('suppliers')
  listSuppliers() {
    return this.purchasing.listSuppliers();
  }

  @Post('suppliers')
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.purchasing.createSupplier(dto);
  }

  @Patch('suppliers/:id')
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSupplierDto) {
    return this.purchasing.updateSupplier(id, dto);
  }

  // ---- Órdenes de compra ----

  @Get('orders')
  listOrders(@BranchScope() branchId?: string, @Query('status') status?: string) {
    return this.purchasing.listPurchaseOrders(branchId || undefined, status || undefined);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.getPurchaseOrder(id);
  }

  @Post('orders')
  createOrder(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.purchasing.createPurchaseOrder(dto, user.id);
  }

  // Recibir → suma stock + costo + movimientos PURCHASE.
  @Post('orders/:id/receive')
  receiveOrder(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.purchasing.receive(id, user.id);
  }

  @Patch('orders/:id/order')
  markOrdered(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.setStatus(id, 'ORDERED');
  }

  @Patch('orders/:id/cancel')
  cancelOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.setStatus(id, 'CANCELLED');
  }
}
