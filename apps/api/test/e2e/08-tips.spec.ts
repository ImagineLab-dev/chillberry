import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Propinas. El bug original: el POS rechazaba con 400 cualquier pago mayor al
 * total ("quedate con el vuelto" era un error de validación). Ahora la propina
 * va aparte del monto, se guarda, entra al cajón y se atribuye al mozo.
 */
test.describe.serial('propinas', () => {
  let token: string;
  let branchId: string;
  let item: { id: string; price: string };

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    item = await getFirstMenuItem(request, token, branchId);
  });

  async function ensureSession(request: import('@playwright/test').APIRequestContext) {
    const open = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (open.ok() && (await open.json())?.id) return;
    await request.post('pos/cash-sessions/open', { headers: authHeader(token), data: { branchId, openingCash: 100000 } });
  }

  test('cobrar con propina: el pago mayor al total ya NO es un error', async ({ request }) => {
    await ensureSession(request);
    const orderRes = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'DINE_IN', items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    const order = await orderRes.json();
    const total = Number(order.total);
    const tipAmount = 5000;

    const charge = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: {
        idempotencyKey: randomUUID(),
        payments: [{ method: 'CASH', amount: total, tip: tipAmount }],
      },
    });
    expect(charge.ok()).toBeTruthy();
    const body = await charge.json();
    // El amount cubre la cuenta; la propina se guarda aparte.
    expect(Number(body.payments[0].amount)).toBe(total);
    expect(Number(body.payments[0].tipAmount)).toBe(tipAmount);
  });

  test('la propina aparece en el reporte por mozo', async ({ request }) => {
    const res = await request.get('pos/tips', { headers: authHeader(token), params: { branchId } });
    expect(res.ok()).toBeTruthy();
    const report = await res.json();
    expect(report.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.byWaiter)).toBe(true);
    // Hay al menos una fila con propina > 0 tras el cobro anterior.
    expect(report.byWaiter.some((r: { total: number }) => r.total > 0)).toBe(true);
  });

  test('el amount de los pagos igual tiene que cuadrar con el total (la propina no lo tapa)', async ({ request }) => {
    const orderRes = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'DINE_IN', items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    const order = await orderRes.json();

    // amount de menos aunque la propina "compense": debe rechazar. La propina
    // no cubre la cuenta.
    const charge = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: {
        idempotencyKey: randomUUID(),
        payments: [{ method: 'CASH', amount: Number(order.total) - 1000, tip: 5000 }],
      },
    });
    expect(charge.status()).toBe(400);
  });
});
