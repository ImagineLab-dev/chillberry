import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CreatePaymentIntentInput,
  CreatePaymentIntentResult,
  PaymentProviderAdapter,
} from '@chillberry/domain';
import { loadEnv } from '../../../config/env';

/**
 * Proveedor "MOCK" — sandbox propio, no llama a ningún servicio externo.
 * Simula lo mínimo que un proveedor real (Bancard/Mercado Pago/DLocal)
 * expone: crear un intent con un id tokenizado propio, y validar la firma
 * HMAC de un webhook contra el secreto compartido.
 *
 * Implementa el mismo contrato `PaymentProviderAdapter` que usarían los
 * adapters reales — cambiar de MOCK a un proveedor real en producción es
 * agregar una clase nueva, no tocar el resto del flujo de pagos.
 */
@Injectable()
export class MockPaymentAdapter implements PaymentProviderAdapter {
  async createIntent(_input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult> {
    // Nunca es un número real de tarjeta ni nada tokenizable a partir de
    // datos sensibles — es solo un id opaco que el mock usa para
    // correlacionar el webhook posterior.
    const providerPaymentId = `mock_${randomUUID()}`;
    return { providerPaymentId };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const secret = loadEnv().MOCK_PROVIDER_SECRET;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    // Comparación de tiempo constante — evita timing attacks al validar
    // firmas de webhook (patrón estándar para HMAC, no solo estética).
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
