import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { strictThrottle } from '../../common/security/throttle.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PosService } from './pos.service';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import { CreateCashMovementDto } from './dto/cash-movement.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';
import { ChargeOrderDto } from './dto/charge-order.dto';
import { RefundOrderDto } from './dto/refund-order.dto';

@Roles(USER_ROLE.Cashier, USER_ROLE.Owner, USER_ROLE.Admin)
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('orders/pending')
  listPending(@BranchScope() branchId: string) {
    return this.pos.listPendingOrders(branchId);
  }

  @Post('cash-sessions/open')
  openSession(@Body() dto: OpenCashSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.openSession(dto, user.id, user);
  }

  @Get('cash-sessions/open')
  getOpenSession(@BranchScope() branchId: string) {
    return this.pos.getOpenSession(branchId);
  }

  @Post('cash-sessions/:id/close')
  closeSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.closeSession(id, dto, user);
  }

  // Endpoints de plata con throttle estricto propio (30/min): más ajustado que
  // el global de 60/min, acota abuso/errores de retry sobre movimientos de caja,
  // cobros, descuentos y reembolsos.
  @Throttle(strictThrottle(30))
  @Post('cash-sessions/:id/movements')
  createMovement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCashMovementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.createMovement(id, dto, user.id, user);
  }

  @Throttle(strictThrottle(30))
  @Post('discounts')
  applyDiscount(@Body() dto: ApplyDiscountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.applyDiscount(dto, user.id);
  }

  @Throttle(strictThrottle(30))
  @Post('orders/:id/charge')
  charge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChargeOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.charge(id, dto, user);
  }

  // Reembolso total o parcial de un pedido cobrado. Registra la salida de caja
  // con responsable (CurrentUser) y motivo.
  @Throttle(strictThrottle(30))
  @Post('orders/:id/refund')
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.refundOrder(id, dto, user.id, user);
  }

  // Propinas por mozo en un rango — para liquidar el turno. `from`/`to` ISO.
  @Get('tips')
  tipsReport(
    @BranchScope() branchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.pos.tipsReport(branchId, from, to);
  }

  // Panel de control anti-robo: descuentos, anulaciones y retiros de caja con
  // quién/cuánto/por qué. Solo OWNER/ADMIN — el CASHIER es a quien se audita,
  // así que se saca del @Roles de la clase con este override.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('control')
  controlReport(
    @BranchScope() branchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.pos.controlReport(branchId, from, to);
  }

  // Historial de arqueos (sesiones de caja cerradas) para auditar cierres
  // cortos/largos. Solo OWNER/ADMIN, mismo criterio que el panel de control.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('cash-sessions')
  listSessions(
    @BranchScope() branchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.pos.listSessions(branchId, from, to);
  }
}
