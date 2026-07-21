import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { strictThrottle } from '../../common/security/throttle.util';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { BillingService } from './billing.service';
import { DlocalWebhookDto } from './dto/dlocal-webhook.dto';

@Controller('webhooks')
export class WebhooksBillingController {
  constructor(private readonly billing: BillingService) {}

  // Público por naturaleza — DLocal no tiene un JWT nuestro. La autenticidad
  // se valida con la firma HMAC (`X-Signature`), no con auth. Ruta separada
  // de `webhooks/payments/:provider` (Fase 3) porque son dos scopes
  // distintos (CUSTOMER_PAYMENT vs SAAS_BILLING) aunque compartan el mismo
  // proveedor DLocal y la misma tabla de idempotencia.
  @Public()
  @Throttle(strictThrottle(120))
  @Post('dlocal')
  @HttpCode(HttpStatus.OK)
  async handle(@Body() dto: DlocalWebhookDto, @Req() req: Request & { rawBody?: Buffer }) {
    const signature = req.headers['x-signature'] as string | undefined;
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(dto));
    return this.billing.processWebhook('dlocal', rawBody, signature, dto);
  }
}
