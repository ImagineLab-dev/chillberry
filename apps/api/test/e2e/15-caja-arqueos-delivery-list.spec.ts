import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Cierres de caja (arqueos) y consola de delivery: los dos endpoints que la
 * auditoría de completitud detectó faltantes (el owner no podía ni auditar
 * cierres pasados ni listar los deliveries para despachar).
 */
test.describe.serial('caja: movimientos + arqueo + lista de delivery', () => {
  let ownerToken: string;
  let branchId: string;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, ownerToken)).id;
  });

  test('un PAY_OUT sin motivo se rechaza (400)', async ({ request }) => {
    // Arranca de cero: si quedó una caja abierta, se cierra.
    const openRes = await request.get('pos/cash-sessions/open', {
      headers: authHeader(ownerToken),
      params: { branchId },
    });
    const current = openRes.ok() ? await openRes.json() : null;
    if (current?.id) {
      await request.post(`pos/cash-sessions/${current.id}/close`, {
        headers: authHeader(ownerToken),
        data: { countedCash: 0 },
      });
    }

    const session = await (
      await request.post('pos/cash-sessions/open', {
        headers: authHeader(ownerToken),
        data: { branchId, openingAmount: 100000 },
      })
    ).json();

    const bad = await request.post(`pos/cash-sessions/${session.id}/movements`, {
      headers: authHeader(ownerToken),
      data: { type: 'PAY_OUT', amount: 20000 },
    });
    expect(bad.status()).toBe(400);

    // Con motivo sí entra y afecta el efectivo esperado.
    const ok = await request.post(`pos/cash-sessions/${session.id}/movements`, {
      headers: authHeader(ownerToken),
      data: { type: 'PAY_OUT', amount: 20000, note: 'Pago a proveedor' },
    });
    expect(ok.ok()).toBeTruthy();

    // Cierre: esperado = apertura 100000 - retiro 20000 = 80000, cuadra en 80000.
    const closed = await (
      await request.post(`pos/cash-sessions/${session.id}/close`, {
        headers: authHeader(ownerToken),
        data: { countedCash: 80000 },
      })
    ).json();
    expect(Number(closed.expectedCash)).toBe(80000);
    expect(Number(closed.difference)).toBe(0);

    // El cierre aparece en el historial de arqueos con su cajero y diferencia.
    const list = await (
      await request.get('pos/cash-sessions', { headers: authHeader(ownerToken), params: { branchId } })
    ).json();
    expect(Array.isArray(list)).toBe(true);
    const mine = list.find((s: { id: string }) => s.id === session.id);
    expect(mine).toBeTruthy();
    expect(Number(mine.difference)).toBe(0);
    expect(Number(mine.expectedCash)).toBe(80000);
    expect(mine.cashierName).toBeTruthy();
  });

  test('la lista de delivery de la sucursal responde con la forma esperada', async ({ request }) => {
    const res = await request.get('delivery', { headers: authHeader(ownerToken), params: { branchId } });
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    // Si hay al menos un delivery, trae el pedido embebido y el estado.
    if (list.length > 0) {
      const d = list[0];
      expect(d.status).toBeTruthy();
      expect(d.order).toBeTruthy();
      expect(d.order.id).toBeTruthy();
    }
  });

  test('el filtro por estado no rompe', async ({ request }) => {
    const res = await request.get('delivery', {
      headers: authHeader(ownerToken),
      params: { branchId, status: 'DELIVERED' },
    });
    expect(res.ok()).toBeTruthy();
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.every((d: { status: string }) => d.status === 'DELIVERED')).toBe(true);
  });
});
