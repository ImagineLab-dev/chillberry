import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Controller, Get, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';

// Reportes financieros → solo dueño/admin.
@Roles(USER_ROLE.Owner, USER_ROLE.Admin)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // `branchId` opcional: sin él, reporte CONSOLIDADO de todas las sucursales.
  @Get('sales')
  sales(@BranchScope() branchId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.sales(branchId || undefined, from, to);
  }
}
