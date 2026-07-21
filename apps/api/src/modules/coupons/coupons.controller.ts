import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

// Los cupones tocan precios: sólo dueño/admin. La VALIDACIÓN pública del código
// (la que usa el cliente en la carta) NO vive acá — va con el pedido público,
// para no exponer un endpoint que permita adivinar códigos a lo bruto.
@Roles(USER_ROLE.Owner, USER_ROLE.Admin)
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list() {
    return this.coupons.list();
  }

  @Post()
  create(@Body() dto: CreateCouponDto, @CurrentUser() user: AuthenticatedUser) {
    return this.coupons.create(dto, user.id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.deactivate(id);
  }

  @Get(':id/redemptions')
  redemptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.redemptions(id);
  }
}
