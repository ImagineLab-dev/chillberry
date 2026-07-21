import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Base de clientes derivada de los pedidos: agrega por teléfono los pedidos
 * COMPLETED para saber quién es cliente frecuente y cuánto gastó.
 */
test.describe.serial('base de clientes', () => {
  let token: string;
  let branchId: string;
  let item: { id: string; price: string };
  const phone = `+59598${Math.floor(1000000 + Math.random() * 8999999)}`;
  const name = `Cliente Test ${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    item = await getFirstMenuItem(request, token, branchId);
  });

  async function completedOrderFor(request: import('@playwright/test').APIRequestContext) {
    const order = await request.post('orders', {
      headers: authHeader(token),
      data: {
        branchId,
        type: 'TAKEAWAY',
        customerName: name,
        customerPhone: phone,
        items: [{ menuItemId: item.id, quantity: 1 }],
      },
    });
    const orderId = (await order.json()).id;
    const open = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (!(open.ok() && (await open.json())?.id)) {
      await request.post('pos/cash-sessions/open', { headers: authHeader(token), data: { branchId, openingCash: 100000 } });
    }
    await request.post(`pos/orders/${orderId}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(item.price) }] },
    });
  }

  test('dos pedidos del mismo teléfono se agregan en un cliente con sus visitas y total', async ({ request }) => {
    await completedOrderFor(request);
    await completedOrderFor(request);

    const res = await request.get('customers', { headers: authHeader(token), params: { search: phone } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    const customer = body.customers.find((c: { phone: string }) => c.phone === phone);
    expect(customer).toBeTruthy();
    expect(customer.orders).toBe(2);
    expect(customer.totalSpent).toBe(2 * Number(item.price));
    expect(customer.avgTicket).toBe(Number(item.price));
    expect(customer.name).toBe(name);
  });

  test('un CASHIER no puede ver la base de clientes', async ({ request }) => {
    const email = `cust-cashier-${Math.random().toString(36).slice(2, 7)}@chillberry-demo.test`;
    const created = await request.post('users', {
      headers: authHeader(token),
      data: { name: 'Cajero', email, password: 'Chillberry123!', role: 'CASHIER' },
    });
    const userId = (await created.json()).id;
    const cashierToken = await login(request, { email, password: 'Chillberry123!' });

    const res = await request.get('customers', { headers: authHeader(cashierToken) });
    expect(res.status()).toBe(403);

    await request.patch(`users/${userId}`, { headers: authHeader(token), data: { active: false } });
  });
});
