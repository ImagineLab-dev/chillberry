import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

@Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Cashier)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intents')
  createIntent(@Body() dto: CreatePaymentIntentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.createIntent(dto, user);
  }

  @Get()
  listByOrder(@Query('orderId') orderId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payments.listByOrder(orderId, user);
  }
}
