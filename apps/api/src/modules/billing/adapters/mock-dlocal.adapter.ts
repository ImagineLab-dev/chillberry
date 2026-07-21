import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CreateSubscriptionIntentInput,
  CreateSubscriptionIntentResult,
  SubscriptionProviderAdapter,
} from '@chillberry/domain';
import { loadEnv } from '../../../config/env';

/**
 * Proveedor "DLOCAL" simulado — sandbox propio, no llama a la API real de
 * DLocal. Mismo patrón que `MockPaymentAdapter` (Fase 3): simula lo mínimo
 * que un proveedor de cobro recurrente expone (crear un intent con un id
 * tokenizado propio, validar la firma HMAC de un webhook contra un secreto
 * compartido). Cambiar a la integración real de DLocal en producción es
 * agregar una clase nueva que implemente el mismo contrato, no tocar el
 * resto del flujo de billing.
 */
@Injectable()
export class MockDlocalAdapter implements SubscriptionProviderAdapter {
  async createSubscriptionIntent(
    _input: CreateSubscriptionIntentInput,
  ): Promise<CreateSubscriptionIntentResult> {
    const providerSubscriptionId = `dlocal_sub_${randomUUID()}`;
    return { providerSubscriptionId };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const secret = loadEnv().DLOCAL_WEBHOOK_SECRET;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(signatureHeader, 'hex');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  /** Helper de testing/documentación: firma un payload como lo haría el "proveedor". */
  static signPayload(rawBody: Buffer, secret: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
  }
}
