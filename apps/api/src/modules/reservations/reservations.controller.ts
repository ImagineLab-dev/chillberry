import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto, UpdateReservationDto } from './dto/reservation.dto';

// Reservas las maneja quien atiende el salón: dueño, admin y mesero.
@Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  create(@Body() dto: CreateReservationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reservations.create(dto, user.id);
  }

  @Get()
  list(
    @BranchScope() branchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.reservations.list(branchId, { from, to, status });
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReservationDto) {
    return this.reservations.update(id, dto);
  }
}
