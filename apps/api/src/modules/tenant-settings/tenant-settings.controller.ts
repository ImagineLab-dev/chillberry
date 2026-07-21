import { Body, Controller, Get, Patch } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantSettingsService } from './tenant-settings.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

@Controller('tenant-settings')
export class TenantSettingsController {
  constructor(private readonly tenantSettings: TenantSettingsService) {}

  // TODAS las superficies de staff formatean plata con la moneda del tenant y
  // por eso piden esto: admin/*, pos (cashier), waiter y driver. Antes solo
  // owner/admin/cashier estaban permitidos, así que waiter y driver comían un
  // 403 silencioso y caían al fallback 'PY'. Solo devuelve país/moneda/timezone
  // (no sensible), así que va abierto a todo el staff. El PATCH sigue owner-only.
  @Roles(
    USER_ROLE.Owner,
    USER_ROLE.Admin,
    USER_ROLE.Cashier,
    USER_ROLE.Waiter,
    USER_ROLE.Kitchen,
    USER_ROLE.Driver,
  )
  @Get()
  getSettings() {
    return this.tenantSettings.getSettings();
  }

  @Roles(USER_ROLE.Owner)
  @Patch()
  updateSettings(@Body() dto: UpdateTenantSettingsDto) {
    return this.tenantSettings.updateSettings(dto);
  }
}
