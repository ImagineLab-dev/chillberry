import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Regresión de los bugs de plata encontrados en la auditoría del 17/07/2026.
 *
 * Cada test de acá corresponde a un bug REAL que estaba en producción y que
 * hacía perder plata o cobrarle de más a un cliente. Si alguno de estos se
 * pone rojo, es que el bug volvió — no lo aflojes, arreglá el código.
 */
test.describe.serial('seguridad de plata: doble cobro, descuentos e idempotencia', () => {
  let token: string;
  let branchId: string;
  let menuItemId: string;
  let price: number;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    const branch = await getFirstBranch(request, token);
    branchId = branch.id;
    const item = await getFirstMenuItem(request, token, branchId);
    menuItemId = item.id;
    price = Number(item.price);
  });

  async function createOrder(request: import('@playwright/test').APIRequestContext, quantity = 4) {
    const res = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId, quantity }] },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as { id: string; total: string; subtotal: string };
  }

  async function ensureOpenSession(request: import('@playwright/test').APIRequestContext) {
    const existing = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (existing.ok()) {
      const body = await existing.json();
      if (body?.id) return body.id as string;
    }
    const opened = await request.post('pos/cash-sessions/open', {
      headers: authHeader(token),
      data: { branchId, openingCash: 100000 },
    });
    return (await opened.json()).id as string;
  }

  // ---------------------------------------------------------------- descuentos

  test('un descuento del 100% no puede repetirse hasta dejar el total NEGATIVO', async ({ request }) => {
    const order = await createOrder(request);

    const first = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: order.id, type: 'PERCENTAGE', value: 100, reason: 'Cortesía por demora' },
    });
    expect(first.ok()).toBeTruthy();

    // El bug: la validación era `amount > subtotal` sobre el descuento SUELTO,
    // así que el segundo 100% también pasaba y dejaba el total en -subtotal,
    // con el pedido imposible de cobrar para siempre.
    const second = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: order.id, type: 'PERCENTAGE', value: 100, reason: 'Otra vez' },
    });
    expect(second.status()).toBe(400);

    const after = await request.get(`orders/${order.id}`, { headers: authHeader(token) });
    expect(Number((await after.json()).total)).toBeGreaterThanOrEqual(0);
  });

  test('dos descuentos parciales que juntos superan el total son rechazados', async ({ request }) => {
    const order = await createOrder(request);

    const a = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: order.id, type: 'PERCENTAGE', value: 60, reason: 'Promo' },
    });
    expect(a.ok()).toBeTruthy();

    const b = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: order.id, type: 'PERCENTAGE', value: 60, reason: 'Otra promo' },
    });
    expect(b.status()).toBe(400);

    const after = await request.get(`orders/${order.id}`, { headers: authHeader(token) });
    expect(Number((await after.json()).total)).toBeGreaterThanOrEqual(0);
  });

  test('un descuento sin motivo es rechazado (es el rastro de auditoría)', async ({ request }) => {
    const order = await createOrder(request);
    const res = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: order.id, type: 'PERCENTAGE', value: 10 },
    });
    expect(res.status()).toBe(400);
  });

  test('un porcentaje mayor a 100 es rechazado', async ({ request }) => {
    const order = await createOrder(request);
    const res = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: order.id, type: 'PERCENTAGE', value: 500, reason: 'Absurdo' },
    });
    expect(res.status()).toBe(400);
  });

  // ------------------------------------------------------------- idempotencia

  test('reintentar el cobro con la MISMA clave no cobra dos veces', async ({ request }) => {
    const order = await createOrder(request);
    await ensureOpenSession(request);
    const key = randomUUID();

    const body = {
      idempotencyKey: key,
      payments: [{ method: 'CASH', amount: Number(order.total) }],
    };

    const first = await request.post(`pos/orders/${order.id}/charge`, { headers: authHeader(token), data: body });
    expect(first.ok()).toBeTruthy();
    const firstPaymentId = (await first.json()).payments[0].id;

    // El bug: `idempotencyKey` se generaba server-side con randomBytes en cada
    // llamada, así que el @unique del schema nunca podía dispararse y un doble
    // click cobraba dos veces.
    const replay = await request.post(`pos/orders/${order.id}/charge`, { headers: authHeader(token), data: body });
    const replayBody = await replay.json();

    if (replay.ok()) {
      // Replay reconocido: mismo Payment, no uno nuevo.
      expect(replayBody.payments[0].id).toBe(firstPaymentId);
    } else {
      // O el pedido ya quedó cerrado, que también impide el doble cobro.
      expect(replay.status()).toBe(409);
    }

    const payments = await request.get(`payments`, { headers: authHeader(token), params: { orderId: order.id } });
    if (payments.ok()) {
      const list = (await payments.json()) as { amount: string }[];
      const totalCobrado = list.reduce((s, p) => s + Number(p.amount), 0);
      expect(totalCobrado).toBeLessThanOrEqual(Number(order.total) + 0.01);
    }
  });

  test('el cobro exige clave de idempotencia', async ({ request }) => {
    const order = await createOrder(request);
    const res = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: { payments: [{ method: 'CASH', amount: Number(order.total) }] },
    });
    expect(res.status()).toBe(400);
  });

  // ------------------------------------------------------- split con pago hecho

  test('no se puede re-dividir una cuenta que ya tiene una parte PAGADA', async ({ request }) => {
    const order = await createOrder(request, 4);
    await ensureOpenSession(request);

    // BY_PERSON: los montos los manda el cliente y tienen que sumar el total.
    const half = Math.round((Number(order.total) / 2) * 100) / 100;
    const other = Math.round((Number(order.total) - half) * 100) / 100;
    const split = await request.post(`waiter/orders/${order.id}/split`, {
      headers: authHeader(token),
      data: {
        mode: 'BY_PERSON',
        parts: [
          { label: 'Ana', amount: half },
          { label: 'Beto', amount: other },
        ],
      },
    });
    expect(split.ok()).toBeTruthy();
    const parts = (await split.json()) as { id: string; amount: string }[];
    expect(parts).toHaveLength(2);

    const paid = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: {
        idempotencyKey: randomUUID(),
        billSplitId: parts[0]!.id,
        payments: [{ method: 'CASH', amount: Number(parts[0]!.amount) }],
      },
    });
    expect(paid.ok()).toBeTruthy();

    // EL BUG: split() hacía `billSplit.deleteMany({where:{orderId}})` sin
    // filtrar los pagados. El único guard anti-doble-pago del sistema es
    // `if (split.paid) throw` en PaymentsService — y vive en la fila que ese
    // deleteMany borraba. Re-dividir destruía la evidencia del pago y el que
    // ya había pagado podía pagar de nuevo. Pasa con solo pedir un postre.
    const reSplit = await request.post(`waiter/orders/${order.id}/split`, {
      headers: authHeader(token),
      data: {
        mode: 'BY_PERSON',
        parts: [
          { label: 'Ana', amount: half },
          { label: 'Beto', amount: other },
        ],
      },
    });
    expect(reSplit.status()).toBe(409);

    // Y la marca de pago sigue viva.
    const stillPaid = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: {
        idempotencyKey: randomUUID(),
        billSplitId: parts[0]!.id,
        payments: [{ method: 'CASH', amount: Number(parts[0]!.amount) }],
      },
    });
    expect(stillPaid.ok()).toBeFalsy();
  });
});
