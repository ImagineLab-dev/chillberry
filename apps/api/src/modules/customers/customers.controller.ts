import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Delete, Get, Post, Put, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CustomersService } from './customers.service';
import { UpsertCustomerDto } from './dto/upsert-customer.dto';
import { MergeCustomersDto } from './dto/merge-customers.dto';

// Datos de clientes = información comercial → dueño/admin.
@Roles(USER_ROLE.Owner, USER_ROLE.Admin)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@BranchScope() branchId?: string, @Query('search') search?: string) {
    return this.customers.list(branchId, search);
  }

  // Alta/edición manual (upsert por teléfono).
  @Put()
  upsert(@Body() dto: UpsertCustomerDto) {
    return this.customers.upsert(dto);
  }

  // Fusionar duplicados.
  @Post('merge')
  merge(@Body() dto: MergeCustomersDto) {
    return this.customers.merge(dto);
  }

  // Historial de pedidos de un cliente. El teléfono va como query (puede traer
  // '+', que en un path param se complica).
  @Get('orders')
  orders(@Query('phone') phone: string) {
    return this.customers.getOrders(phone);
  }

  // Borra la ficha (no los pedidos). Teléfono por query, mismo motivo.
  @Delete()
  remove(@Query('phone') phone: string) {
    return this.customers.remove(phone);
  }
}
