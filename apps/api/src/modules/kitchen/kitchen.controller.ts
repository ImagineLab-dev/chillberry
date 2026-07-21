import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { KitchenService } from './kitchen.service';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';

@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  // Tablero de cocina: mismo trío que `updateTaskStatus` acá abajo — quien ve
  // el board es quien avanza las tareas (`app/kitchen/page.tsx`).
  @Roles(USER_ROLE.Kitchen, USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('board')
  board(@BranchScope() branchId: string) {
    return this.kitchen.listBoard(branchId);
  }

  // A pesar del prefijo `kitchen/`, el único caller es `app/admin/menu`, que
  // asigna cada producto a una estación. El tablero de cocina no lo usa.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('stations')
  stations(@BranchScope() branchId: string) {
    return this.kitchen.listStations(branchId);
  }

  @Roles(USER_ROLE.Kitchen, USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('tasks/:id/status')
  updateTaskStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kitchen.updateTaskStatus(id, dto.status, user.id);
  }

  // Recall / deshacer: retrocede la tarea un paso (marcó listo/entregado por
  // error). Mismo trío que avanza tareas.
  @Roles(USER_ROLE.Kitchen, USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('tasks/:id/recall')
  recallTask(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.kitchen.recallTask(id, user.id);
  }
}
