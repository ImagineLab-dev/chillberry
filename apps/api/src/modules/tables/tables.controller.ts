import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TablesService } from './tables.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post()
  create(@Body() dto: CreateTableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tables.create(dto, actorDe(user));
  }

  // ESTA es la única ruta que devuelve el `qrToken`, y por eso es dueño/admin:
  // el token es la credencial con la que un cliente pide sin autenticarse
  // (`public/menu/:qrToken`), así que quien lo lee puede pedir y ver la cuenta
  // en nombre de cualquier mesa. Callers: admin/tables (imprimir los QR) y
  // admin/orders. El mozo usa `/waiter/tables`, que devuelve las mesas con un
  // `select` acotado — sin el token (ver `TABLE_SAFE_SELECT`).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get()
  list(@BranchScope() branchId?: string) {
    return this.tables.list(branchId);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tables.getOrThrow(id, actorDe(user));
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tables.update(id, dto, actorDe(user));
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post(':id/rotate-qr')
  rotateQr(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tables.rotateQr(id, actorDe(user));
  }

  // Borrado DURO — solo si la mesa no tiene pedidos ni reservas (si no, 409 y
  // hay que desactivarla vía PATCH {active:false}).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tables.remove(id, actorDe(user));
  }
}

/** Rol + sucursal del JWT: lo que el service necesita para el control por id. */
function actorDe(user: AuthenticatedUser) {
  return { id: user.id, role: user.role, branchId: user.branchId };
}
