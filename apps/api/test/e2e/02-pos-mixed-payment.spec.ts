import { createHmac, randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

const MOCK_PROVIDER_SECRET = process.env.MOCK_PROVIDER_SECRET ?? 'dev-mock-secret-para-pruebas-locales-1234';

function signMockWebhook(body: string): string {
  return createHmac('sha256', MOCK_PROVIDER_SECRET).update(Buffer.from(body)).digest('hex');
}

/**
 * Flujo 3 del checklist original: caja cobra un pedido con pago mixto
 * (efectivo + tarjeta) -> se emite comprobante. La parte de tarjeta usa el
 * proveedor MOCK (sandbox de la Fase 3): queda PROCESSING hasta que llega el
 * webhook de aprobación, así que este test también dispara ese webhook
 * firmado — sin eso el pedido nunca llegaría a pagado 100% y no se emitiría
 * factura, sería un falso positivo si solo probáramos el cobro en efectivo.
 */
test.describe.serial('caja: cobro mixto efectivo + tarjeta -> comprobante', () => {
  let token: string;
  let branchId: string;
  let orderId: string;
  let orderTotal: number;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
  });

  test('crear un pedido para llevar', async ({ request }) => {
    const branch = await getFirstBranch(request, token);
    branchId = branch.id;
    const menuItem = await getFirstMenuItem(request, token, branchId);

    const orderRes = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId: menuItem.id, quantity: 3 }] },
    });
    expect(orderRes.ok()).toBeTruthy();
    const order = await orderRes.json();
    orderId = order.id;
    orderTotal = Number(order.total);
    expect(orderTotal).toBeGreaterThan(0);
  });

  test('asegurar que hay una caja abierta en la sucursal', async ({ request }) => {
    const openRes = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    expect(openRes.ok()).toBeTruthy();
    // Cuando no hay caja abierta, el endpoint devuelve un body vacío (no el
    // literal JSON "null") — Nest no serializa nada para un handler que
    // resuelve a `null`, así que hay que chequear el texto crudo antes de
    // intentar parsear JSON.
    const rawBody = await openRes.text();
    const existing = rawBody ? JSON.parse(rawBody) : null;
    if (existing) return; // ya hay una caja abierta de una corrida anterior — no abrir una segunda (409).

    const openNew = await request.post('pos/cash-sessions/open', {
      headers: authHeader(token),
      data: { branchId, openingAmount: 100000 },
    });
    expect(openNew.ok()).toBeTruthy();
  });

  test('cobrar mitad efectivo, mitad tarjeta (MOCK)', async ({ request }) => {
    const half = Math.round((orderTotal / 2) * 100) / 100;
    const rest = Math.round((orderTotal - half) * 100) / 100;

    const chargeRes = await request.post(`pos/orders/${orderId}/charge`, {
      headers: authHeader(token),
      data: {
        // Obligatoria desde el fix de idempotencia: antes la clave se generaba
        // server-side por llamada y el @unique nunca podía dispararse, así que
        // un doble click cobraba dos veces. Ver 06-money-safety.spec.ts.
        idempotencyKey: randomUUID(),
        payments: [
          { method: 'CASH', amount: half },
          { method: 'CARD', amount: rest, provider: 'MOCK' },
        ],
      },
    });
    expect(chargeRes.ok()).toBeTruthy();
    const result = await chargeRes.json();
    expect(result.payments).toHaveLength(2);

    // El pedido NO está completo todavía — la parte CASH se aprueba al
    // instante pero la de tarjeta queda PROCESSING hasta el webhook.
    expect(result.order.status).not.toBe('COMPLETED');

    const cardPayment = result.payments.find((p: { method: string }) => p.method === 'CARD');
    expect(cardPayment.status).toBe('PROCESSING');
    expect(cardPayment.providerPaymentId).toBeTruthy();

    const eventId = `e2e-card-${orderId}`;
    const webhookBody = JSON.stringify({
      eventId,
      eventType: 'PAYMENT_APPROVED',
      providerPaymentId: cardPayment.providerPaymentId,
    });
    const signature = signMockWebhook(webhookBody);

    const webhookRes = await request.post('webhooks/payments/mock', {
      headers: { 'X-Signature': signature },
      data: JSON.parse(webhookBody),
    });
    expect(webhookRes.ok()).toBeTruthy();
    const webhookResult = await webhookRes.json();
    expect(webhookResult.duplicate).toBe(false);

    // Replay del mismo evento -> debe reportarse duplicado, no reprocesarse.
    const replayRes = await request.post('webhooks/payments/mock', {
      headers: { 'X-Signature': signature },
      data: JSON.parse(webhookBody),
    });
    expect(replayRes.ok()).toBeTruthy();
    expect((await replayRes.json()).duplicate).toBe(true);
  });

  test('el pedido queda COMPLETED y se emitió un comprobante', async ({ request }) => {
    const orderRes = await request.get(`orders/${orderId}`, { headers: authHeader(token) });
    const order = await orderRes.json();
    expect(order.status).toBe('COMPLETED');

    const invoiceRes = await request.get(`invoices/${orderId}`, { headers: authHeader(token) });
    expect(invoiceRes.ok()).toBeTruthy();
    const invoice = await invoiceRes.json();
    expect(invoice.status).toBe('ISSUED');
    expect(Number(invoice.totalAmount)).toBeCloseTo(orderTotal, 2);
  });
});
