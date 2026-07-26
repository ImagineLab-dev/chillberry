import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { USER_ROLE } from '@chillberry/domain';
import { strictThrottle } from '../../common/security/throttle.util';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SupportService } from './support.service';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // Cualquier miembro del staff puede reportar un problema o sugerir algo — es
  // el propio restaurante hablándole a Chillberry. El super-admin los ve/gestiona
  // desde `/super-admin/support` (ver SuperAdminController). Rate-limit propio:
  // reportar es de baja frecuencia; un pico acá es spam o un script.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter, USER_ROLE.Cashier, USER_ROLE.Kitchen)
  @Throttle(strictThrottle(10))
  @Post()
  create(@Body() dto: CreateSupportRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.support.create(dto, user);
  }
}
