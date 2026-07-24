import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
// Import explícito: `URL` es global en Node, pero la config de ESLint de este
// paquete no declara los globals del runtime y lo marcaba como no definido.
import { URL } from 'node:url';
import type {
  CreateSubscriptionIntentInput,
  CreateSubscriptionIntentResult,
  SubscriptionProviderAdapter,
} from '@chillberry/domain';
import { loadEnv } from '../../../config/env';

/**
 * Integración REAL de dLocal Go para el cobro de suscripciones. Se activa con
 * BILLING_PROVIDER=dlocal + DLOCAL_API_KEY/DLOCAL_SECRET_KEY (ver env.ts). Mismo
 * contrato que `MockDlocalAdapter`, así que el resto del flujo de billing no
 * cambia.
 *
 * Contrato de dLocal Go (docs.dlocalgo.com):
 *  - Auth de la API:  `Authorization: Bearer {apiKey}:{secretKey}`.
 *  - Crear plan:      POST {base}/v1/subscription/plan
 *                     body { name, description, currency, amount, frequency_type }
 *                     resp { id, plan_token, subscribe_url }.
 *                     El cliente entra al `subscribe_url`, carga la tarjeta y
 *                     dLocal cobra al suscribirse y en cada renovación.
 *  - Webhook:         header `Authorization: V2-HMAC-SHA256, Signature: <hex>`,
 *                     con firma = HMAC_SHA256(apiKey + rawBody, secretKey).
 *
 * El webhook se registra POR API (`notification_url` al crear el plan) — no hace
 * falta cargarlo a mano en el panel de dLocal.
 *
 * ⚠️ NO probado end-to-end desde este entorno (sin tarjeta/sandbox alcanzable).
 * PENDIENTE de completar contra el sandbox: el body del webhook de dLocal es
 * `{ payment_id }` (NO trae el estado) — hay que hacer GET del pago para leer su
 * estado y correlacionarlo con la suscripción (por `external_id`, que se manda
 * en el subscribe_url). Ese mapeo depende de la forma real de la respuesta del
 * "retrieve payment", que no está confirmada acá.
 */
@Injectable()
export class DlocalGoAdapter implements SubscriptionProviderAdapter {
  private readonly logger = new Logger(DlocalGoAdapter.name);

  private credentials() {
    const env = loadEnv();
    if (!env.DLOCAL_API_KEY || !env.DLOCAL_SECRET_KEY) {
      throw new Error(
        'BILLING_PROVIDER=dlocal pero faltan DLOCAL_API_KEY/DLOCAL_SECRET_KEY en el entorno.',
      );
    }
    return { apiKey: env.DLOCAL_API_KEY, secretKey: env.DLOCAL_SECRET_KEY, base: env.DLOCAL_API_BASE };
  }

  /**
   * URL del webhook, REGISTRADA POR API (no a mano en el panel de dLocal): se
   * manda como `notification_url` al crear el plan. Se deriva del dominio público
   * (primer WEB_ORIGIN) para no hardcodear el host.
   */
  private webhookUrl(): string {
    const origin = loadEnv().WEB_ORIGIN.split(',')[0]!.trim().replace(/\/+$/, '');
    return `${origin}/api/webhooks/payments/dlocal`;
  }

  async createSubscriptionIntent(
    input: CreateSubscriptionIntentInput,
  ): Promise<CreateSubscriptionIntentResult> {
    const { apiKey, secretKey, base } = this.credentials();

    const res = await fetch(`${base}/v1/subscription/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}:${secretKey}`,
      },
      body: JSON.stringify({
        name: `Chillberry ${input.planId}`,
        description: `Suscripción Chillberry (plan ${input.planId})`,
        currency: input.currency,
        amount: input.amount,
        frequency_type: 'MONTHLY',
        // OBLIGATORIO en la API real de dLocal (verificado contra el sandbox/prod
        // el 21/07/2026: sin esto responde 400 "frequency_value cannot be null").
        // 1 = una vez por mes. El adaptador no lo mandaba y el cobro habría
        // fallado en el primer intento real.
        frequency_value: 1,
        // Webhook registrado POR API (no a mano en el panel): dLocal notifica a
        // esta URL el cobro inicial y cada renovación.
        notification_url: this.webhookUrl(),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`dLocal Go createSubscriptionIntent ${res.status}: ${text}`);
      throw new Error(`No se pudo crear el plan de dLocal (${res.status})`);
    }

    const plan = (await res.json()) as { id: string | number; plan_token?: string; subscribe_url: string };

    // `external_id` en el subscribe_url para correlacionar el webhook con esta
    // suscripción (dLocal lo devuelve en el pago). Máx 255 chars.
    let redirectUrl = plan.subscribe_url;
    try {
      const url = new URL(plan.subscribe_url);
      url.searchParams.set('external_id', `${input.tenantId}:${input.planId}`);
      redirectUrl = url.toString();
    } catch {
      // Si subscribe_url no fuese absoluta, se usa tal cual.
    }

    return { providerSubscriptionId: String(plan.plan_token ?? plan.id), redirectUrl };
  }

  /**
   * Verifica la firma del webhook: header `V2-HMAC-SHA256, Signature: <hex>`,
   * donde <hex> = HMAC_SHA256(apiKey + rawBody, secretKey).
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const { apiKey, secretKey } = this.credentials();

    const match = /Signature:\s*([0-9a-fA-F]+)/.exec(signatureHeader);
    const received = match?.[1];
    if (!received) return false;

    const expected = createHmac('sha256', secretKey).update(apiKey).update(rawBody).digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(received, 'hex');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  }
}
