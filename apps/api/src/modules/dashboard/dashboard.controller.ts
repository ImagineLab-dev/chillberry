import { Controller, Get } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // Facturación del día y métricas del negocio: solo dueño y admin. Único
  // caller: `app/admin/dashboard/page.tsx`.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('summary')
  getSummary() {
    return this.dashboard.getSummary();
  }
}
