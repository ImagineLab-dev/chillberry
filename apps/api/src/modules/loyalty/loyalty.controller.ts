import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { LoyaltyService } from './loyalty.service';
import { AdjustPointsDto, RedeemDto, UpdateProgramDto } from './dto/loyalty.dto';

@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  // Config del programa: dueño/admin.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('program')
  getProgram() {
    return this.loyalty.getProgram();
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('program')
  updateProgram(@Body() dto: UpdateProgramDto) {
    return this.loyalty.updateProgram(dto);
  }

  // Consultar saldo de un cliente y canjear: también el cajero (lo usa al cobrar).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Cashier)
  @Get('accounts/:phone')
  getAccount(@Param('phone') phone: string) {
    return this.loyalty.getAccount(phone);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Cashier)
  @Post('redeem')
  redeem(@Body() dto: RedeemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.redeem({ orderId: dto.orderId, phone: dto.phone, points: dto.points, userId: user.id });
  }

  // Ajuste manual de puntos (corrección/cortesía) — dueño/admin.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('adjust')
  adjust(@Body() dto: AdjustPointsDto) {
    return this.loyalty.adjustPoints(dto.phone, dto.delta, dto.note);
  }
}
