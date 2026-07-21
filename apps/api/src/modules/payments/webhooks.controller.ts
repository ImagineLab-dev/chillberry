import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { strictThrottle } from '../../common/security/throttle.util';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';
import { MockPaymentWebhookDto } from './dto/payment-webhook.dto';

@Controller('webhooks/payments')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  // Público por naturaleza — el proveedor de pago no tiene un JWT nuestro.
  // La autenticidad se valida con la firma HMAC (`X-Signature`), no con auth.
  @Public()
  @Throttle(strictThrottle(120))
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Param('provider') provider: string,
    @Body() dto: MockPaymentWebhookDto,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    const signature = req.headers['x-signature'] as string | undefined;
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(dto));
    return this.payments.processWebhook(provider, rawBody, signature, dto);
  }
}
