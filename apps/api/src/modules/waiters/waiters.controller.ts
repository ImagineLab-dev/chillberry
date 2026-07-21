import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { WaitersService } from './waiters.service';
import { TransferTableDto } from './dto/transfer-table.dto';
import { MergeTablesDto } from './dto/merge-tables.dto';
import { SplitOrderDto } from './dto/split-order.dto';

@Roles(USER_ROLE.Waiter, USER_ROLE.Owner, USER_ROLE.Admin)
@Controller('waiter')
export class WaitersController {
  constructor(private readonly waiters: WaitersService) {}

  @Get('tables')
  listTables(@BranchScope() branchId: string) {
    return this.waiters.listTables(branchId);
  }

  @Post('tables/:id/open')
  openTable(@Param('id', ParseUUIDPipe) id: string) {
    return this.waiters.openTable(id);
  }

  @Post('tables/transfer')
  transfer(@Body() dto: TransferTableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.waiters.transfer(dto, user.id);
  }

  @Post('tables/merge')
  merge(@Body() dto: MergeTablesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.waiters.merge(dto, user.id);
  }

  @Post('orders/:id/request-bill')
  requestBill(@Param('id', ParseUUIDPipe) id: string) {
    return this.waiters.requestBill(id);
  }

  @Post('orders/:id/split')
  split(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SplitOrderDto) {
    return this.waiters.split(id, dto);
  }
}
