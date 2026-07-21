import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Fidelización: se ganan puntos al cobrar y se canjean como descuento. Lo
 * crítico a fijar: el canje reutiliza la MISMA validación de tope que el
 * descuento del POS, así que tampoco puede dejar el total negativo.
 */
test.describe.serial('fidelización (puntos)', () => {
  let token: string;
  let branchId: string;
  let item: { id: string; price: string };
  const phone = `+59598${Math.floor(1000000 + Math.random() * 8999999)}`;

  const EARN_PER = 1000;
  const POINT_VALUE = 50;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    item = await getFirstMenuItem(request, token, branchId);
    // Asegurar una caja abierta para poder cobrar.
    const open = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (!(open.ok() && (await open.json())?.id)) {
      await request.post('pos/cash-sessions/open', { headers: authHeader(token), data: { branchId, openingCash: 100000 } });
    }
  });

  async function chargedOrder(request: import('@playwright/test').APIRequestContext, withPhone: boolean) {
    const order = await request.post('orders', {
      headers: authHeader(token),
      data: {
        branchId,
        type: 'TAKEAWAY',
        ...(withPhone ? { customerName: 'Cliente Fiel', customerPhone: phone } : {}),
        items: [{ menuItemId: item.id, quantity: 1 }],
      },
    });
    const orderId = (await order.json()).id;
    await request.post(`pos/orders/${orderId}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(item.price) }] },
    });
    return orderId;
  }

  test('activar el programa de puntos', async ({ request }) => {
    const res = await request.patch('loyalty/program', {
      headers: authHeader(token),
      data: { active: true, earnPer: EARN_PER, pointValue: POINT_VALUE },
    });
    expect(res.ok()).toBeTruthy();
    const p = await res.json();
    expect(p.active).toBe(true);
  });

  test('cobrar un pedido con teléfono acredita puntos', async ({ request }) => {
    await chargedOrder(request, true);
    const res = await request.get(`loyalty/accounts/${encodeURIComponent(phone)}`, { headers: authHeader(token) });
    expect(res.ok()).toBeTruthy();
    const account = await res.json();
    const expected = Math.floor(Number(item.price) / EARN_PER);
    expect(account.points).toBe(expected);
  });

  test('canjear puntos aplica un descuento y baja el saldo', async ({ request }) => {
    const before = await (await request.get(`loyalty/accounts/${encodeURIComponent(phone)}`, { headers: authHeader(token) })).json();

    const order = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    const orderId = (await order.json()).id;

    const res = await request.post('loyalty/redeem', {
      headers: authHeader(token),
      data: { phone, orderId, points: 5 },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.pointsRedeemed).toBe(5);
    expect(result.discountAmount).toBe(5 * POINT_VALUE);
    expect(result.remainingPoints).toBe(before.points - 5);
  });

  test('canjear más de lo que descuenta el pedido nunca deja el total negativo', async ({ request }) => {
    // Acumular varios puntos primero.
    await chargedOrder(request, true);
    await chargedOrder(request, true);

    const order = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    const orderId = (await order.json()).id;
    const orderTotal = Number((await order.json()).total ?? item.price);

    // Intentar canjear muchísimos puntos: el descuento se topea al total.
    const account = await (await request.get(`loyalty/accounts/${encodeURIComponent(phone)}`, { headers: authHeader(token) })).json();
    const res = await request.post('loyalty/redeem', {
      headers: authHeader(token),
      data: { phone, orderId, points: account.points },
    });
    // O canjea solo lo que entra (200 con descuento ≤ total), o rechaza — nunca
    // deja el pedido en negativo.
    if (res.ok()) {
      const result = await res.json();
      expect(result.discountAmount).toBeLessThanOrEqual(Number(item.price) + 0.01);
      expect(result.newOrderTotal).toBeGreaterThanOrEqual(0);
    } else {
      expect([400, 409]).toContain(res.status());
    }
    void orderTotal;
  });

  test('un WAITER no puede configurar el programa', async ({ request }) => {
    const email = `loy-waiter-${Math.random().toString(36).slice(2, 7)}@chillberry-demo.test`;
    const created = await request.post('users', {
      headers: authHeader(token),
      data: { name: 'Mozo', email, password: 'Chillberry123!', role: 'WAITER' },
    });
    const userId = (await created.json()).id;
    const waiterToken = await login(request, { email, password: 'Chillberry123!' });

    const res = await request.patch('loyalty/program', {
      headers: authHeader(waiterToken),
      data: { active: false },
    });
    expect(res.status()).toBe(403);

    await request.patch(`users/${userId}`, { headers: authHeader(token), data: { active: false } });
  });
});
