import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get()
  list() {
    return this.users.list();
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.update(id, dto, user);
  }

  // Borrado DURO — solo cuando el usuario no tiene historial (pedidos, cobros,
  // entregas, auditoría). Si tiene, el service tira 409 y hay que desactivarlo.
  // Sirve para limpiar cuentas de prueba que nunca operaron.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.users.remove(id, user);
  }
}
