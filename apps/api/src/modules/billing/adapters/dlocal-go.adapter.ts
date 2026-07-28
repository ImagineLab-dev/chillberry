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
  private webhookUrl(ref: string): string {
    const origin = loadEnv().WEB_ORIGIN.split(',')[0]!.trim().replace(/\/+$/, '');
    // Webhook de SUSCRIPCIONES (SAAS_BILLING) → WebhooksBillingController
    // (`/webhooks/dlocal`). NO el de pagos de pedidos (`/webhooks/payments/:provider`).
    //
    // Correlación: el webhook de dLocal trae SÓLO `payment_id`, sin referencia a
    // NUESTRA suscripción, y el pago tampoco la trae (su `order_id` lo genera
    // dLocal). Como el `notification_url` es por-plan y creamos un plan por
    // suscripción, embebemos el `ref` (el tenant — una suscripción por tenant)
    // para reencontrar la suscripción cuando llega el aviso.
    const url = new URL(`${origin}/api/webhooks/dlocal`);
    url.searchParams.set('ref', ref);
    return url.toString();
  }

  /**
   * Estado de un pago (dLocal Go: GET /v1/payments/:id). El webhook trae sólo el
   * `payment_id`; acá se lee el `status` (PENDING|PAID|REJECTED|CANCELLED|EXPIRED)
   * y el `order_id`. Auth Bearer `{apiKey}:{secretKey}`, igual que crear el plan.
   */
  async retrievePaymentStatus(paymentId: string): Promise<{ status: string; orderId: string | null }> {
    const { apiKey, secretKey, base } = this.credentials();
    const res = await fetch(`${base}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${apiKey}:${secretKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`dLocal Go retrievePaymentStatus ${res.status}: ${text}`);
      throw new Error(`No se pudo consultar el pago de dLocal (${res.status})`);
    }
    const pago = (await res.json()) as { status?: string; order_id?: string };
    // Diagnóstico de la PRIMERA prueba real: la forma exacta de esta respuesta no
    // está confirmada contra dLocal. Se loguean las CLAVES y los campos que nos
    // importan (NO el body entero, que puede traer datos de tarjeta) para poder
    // confirmar de un vistazo que `status`/`order_id` llegan con esos nombres. Si
    // no coinciden, acá se ve al toque en vez de fallar en silencio.
    this.logger.log(
      `dLocal retrievePayment ${paymentId}: status=${pago.status ?? '∅'} order_id=${pago.order_id ?? '∅'} keys=[${Object.keys(pago ?? {}).join(',')}]`,
    );
    return { status: String(pago.status ?? '').toUpperCase(), orderId: pago.order_id ?? null };
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
        // País del tenant (ISO alpha-2) para preseleccionar el país en el
        // checkout — el pagador no lo elige. dLocal acepta country + USD juntos
        // (verificado 25/07/2026), así que se prellena SIN cambiar la moneda.
        // Sin country, dLocal pregunta el país (y exige moneda USD).
        ...(input.country ? { country: input.country.toUpperCase() } : {}),
        currency: input.currency,
        amount: input.amount,
        frequency_type: 'MONTHLY',
        // OBLIGATORIO en la API real de dLocal (verificado contra el sandbox/prod
        // el 21/07/2026: sin esto responde 400 "frequency_value cannot be null").
        // 1 = una vez por mes. El adaptador no lo mandaba y el cobro habría
        // fallado en el primer intento real.
        frequency_value: 1,
        // Webhook registrado POR API (no a mano en el panel): dLocal notifica a
        // esta URL el cobro inicial y cada renovación. Lleva el `ref` del tenant
        // para correlacionar el aviso (que sólo trae payment_id) con la suscripción.
        notification_url: this.webhookUrl(input.tenantId),
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
