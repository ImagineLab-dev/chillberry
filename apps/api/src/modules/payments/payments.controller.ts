import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

@Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Cashier)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('intents')
  createIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.payments.createIntent(dto);
  }

  @Get()
  listByOrder(@Query('orderId') orderId: string) {
    return this.payments.listByOrder(orderId);
  }
}
