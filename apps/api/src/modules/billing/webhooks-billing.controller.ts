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
    // dLocal REAL manda la firma en `Authorization: V2-HMAC-SHA256, Signature: <hex>`
    // (verificado en docs.dlocalgo.com); el mock (tests) usa `X-Signature: <hex>`.
    // Se toma la primera presente — el adaptador activo parsea el formato que le
    // corresponde. Sin esto el path real rechazaba el 100% de los webhooks.
    const signature =
      (req.headers['authorization'] as string | undefined) ??
      (req.headers['x-signature'] as string | undefined);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(dto));
    // `ref` (tenant) viaja en el query del notification_url que registramos por
    // API — es la correlación del webhook real de dLocal (que sólo trae payment_id).
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined;
    return this.billing.processWebhook('dlocal', rawBody, signature, dto, ref);
  }
}
