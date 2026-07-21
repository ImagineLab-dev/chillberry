import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post()
  create(@Body() dto: CreateTableDto) {
    return this.tables.create(dto);
  }

  // ESTA es la única ruta que devuelve el `qrToken`, y por eso es dueño/admin:
  // el token es la credencial con la que un cliente pide sin autenticarse
  // (`public/menu/:qrToken`), así que quien lo lee puede pedir y ver la cuenta
  // en nombre de cualquier mesa. Callers: admin/tables (imprimir los QR) y
  // admin/orders. El mozo usa `/waiter/tables`, que devuelve las mesas con un
  // `select` acotado — sin el token (ver `TABLE_SAFE_SELECT`).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get()
  list(@Query('branchId') branchId?: string) {
    return this.tables.list(branchId);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tables.getOrThrow(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto) {
    return this.tables.update(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post(':id/rotate-qr')
  rotateQr(@Param('id', ParseUUIDPipe) id: string) {
    return this.tables.rotateQr(id);
  }

  // Borrado DURO — solo si la mesa no tiene pedidos ni reservas (si no, 409 y
  // hay que desactivarla vía PATCH {active:false}).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tables.remove(id);
  }
}
