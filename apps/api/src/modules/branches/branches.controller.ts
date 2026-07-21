import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { SetBranchHoursDto } from './dto/set-branch-hours.dto';
import { CreateClosureDto } from './dto/create-closure.dto';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  // Casi toda pantalla de staff arranca eligiendo sucursal: admin/*, pos,
  // waiter y kitchen llaman este listado. DRIVER no — su pantalla trabaja solo
  // contra /delivery/*.
  @Roles(
    USER_ROLE.Owner,
    USER_ROLE.Admin,
    USER_ROLE.Waiter,
    USER_ROLE.Kitchen,
    USER_ROLE.Cashier,
  )
  @Get()
  list(@Query('restaurantId') restaurantId?: string) {
    return this.branches.list(restaurantId);
  }

  // Sin callers en el front (las pantallas usan el listado). Se queda acotado;
  // si alguna pantalla de staff lo necesita después, se amplía con el caso a la
  // vista en vez de dejarlo abierto de arranque.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.getOrThrow(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  // --- Horario de atención para el pedido online ---

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get(':id/schedule')
  getSchedule(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.getSchedule(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Put(':id/hours')
  setHours(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetBranchHoursDto) {
    return this.branches.setHours(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post(':id/closures')
  addClosure(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateClosureDto) {
    return this.branches.addClosure(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete(':id/closures/:closureId')
  removeClosure(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('closureId', ParseUUIDPipe) closureId: string,
  ) {
    return this.branches.removeClosure(id, closureId);
  }
}
