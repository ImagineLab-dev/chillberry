import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Control interno anti-robo: cada anulación, descuento y retiro de caja deja
 * rastro de QUIÉN, CUÁNTO y POR QUÉ, y el dueño lo puede ver. Responde la
 * pregunta de la demo: "¿cómo sé que no me roban?".
 */
test.describe.serial('control interno: atribución y panel', () => {
  let token: string;
  let branchId: string;
  let item: { id: string };

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    item = await getFirstMenuItem(request, token, branchId);
  });

  async function newOrder(request: import('@playwright/test').APIRequestContext) {
    const res = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    return (await res.json()) as { id: string };
  }

  test('cancelar sin motivo es rechazado', async ({ request }) => {
    const order = await newOrder(request);
    const res = await request.patch(`orders/${order.id}/status`, {
      headers: authHeader(token),
      data: { status: 'CANCELLED' },
    });
    expect(res.status()).toBe(400);
  });

  test('cancelar con motivo guarda el motivo y aparece en el panel de control', async ({ request }) => {
    const order = await newOrder(request);
    const reason = `Prueba control ${Date.now()}`;
    const cancel = await request.patch(`orders/${order.id}/status`, {
      headers: authHeader(token),
      data: { status: 'CANCELLED', reason },
    });
    expect(cancel.ok()).toBeTruthy();

    const control = await request.get('pos/control', { headers: authHeader(token), params: { branchId } });
    expect(control.ok()).toBeTruthy();
    const report = await control.json();
    const found = report.cancellations.find((c: { reason: string }) => c.reason === reason);
    expect(found).toBeTruthy();
    // La anulación tiene responsable (no "Sistema").
    expect(found.by).toBeTruthy();
    expect(found.by).not.toBe('Sistema');
  });

  test('un retiro de caja PAY_OUT exige motivo', async ({ request }) => {
    const open = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    const openBody = open.ok() ? await open.json() : null;
    let sessionId: string;
    if (openBody?.id) {
      sessionId = openBody.id;
    } else {
      const created = await request.post('pos/cash-sessions/open', {
        headers: authHeader(token),
        data: { branchId, openingCash: 100000 },
      });
      sessionId = (await created.json()).id;
    }

    const noReason = await request.post(`pos/cash-sessions/${sessionId}/movements`, {
      headers: authHeader(token),
      data: { type: 'PAY_OUT', amount: 20000 },
    });
    expect(noReason.status()).toBe(400);

    const withReason = await request.post(`pos/cash-sessions/${sessionId}/movements`, {
      headers: authHeader(token),
      data: { type: 'PAY_OUT', amount: 20000, note: 'Compra de servilletas' },
    });
    expect(withReason.ok()).toBeTruthy();

    const control = await request.get('pos/control', { headers: authHeader(token), params: { branchId } });
    const report = await control.json();
    const found = report.cashMovements.find(
      (m: { type: string; note: string }) => m.type === 'PAY_OUT' && m.note === 'Compra de servilletas',
    );
    expect(found).toBeTruthy();
    expect(found.by).not.toBe('Sistema');
  });
});
