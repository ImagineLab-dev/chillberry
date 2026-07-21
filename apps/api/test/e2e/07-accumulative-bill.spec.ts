import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Cuenta acumulativa por mesa: agregar una segunda ronda a un pedido abierto
 * ("agregame un postre a la mesa 4"). Es el flujo central del rubro —
 * picada → milanesas → postre, una sola cuenta— y no existía.
 */
test.describe.serial('agregar rondas a un pedido abierto', () => {
  let token: string;
  let branchId: string;
  let itemA: { id: string; price: string };
  let itemB: { id: string; price: string };
  let orderId: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    itemA = await getFirstMenuItem(request, token, branchId);
    const itemsRes = await request.get('menu/items', { headers: authHeader(token), params: { branchId } });
    const items = (await itemsRes.json()) as { id: string; price: string }[];
    itemB = items[1]!;
  });

  test('crear el pedido inicial (ronda 1)', async ({ request }) => {
    const res = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'DINE_IN', items: [{ menuItemId: itemA.id, quantity: 1 }] },
    });
    expect(res.ok()).toBeTruthy();
    const order = await res.json();
    orderId = order.id;
    expect(Number(order.total)).toBe(Number(itemA.price));
    expect(order.items.every((i: { round: number }) => i.round === 1)).toBe(true);
  });

  test('agregar una segunda ronda: el total acumula y los ítems quedan en ronda 2', async ({ request }) => {
    const res = await request.post(`orders/${orderId}/items`, {
      headers: authHeader(token),
      data: { items: [{ menuItemId: itemB.id, quantity: 2, notes: 'para compartir' }] },
    });
    expect(res.ok()).toBeTruthy();
    const order = await res.json();

    expect(Number(order.total)).toBe(Number(itemA.price) + 2 * Number(itemB.price));

    const round2 = order.items.filter((i: { round: number }) => i.round === 2);
    expect(round2).toHaveLength(1);
    expect(round2[0].quantity).toBe(2);
    expect(round2[0].notes).toBe('para compartir');
    // El estado vuelve a WAITING: la ronda nueva todavía no se cocinó.
    expect(order.status).toBe('WAITING');
  });

  test('la segunda ronda llegó a cocina SIN re-disparar la primera', async ({ request }) => {
    const res = await request.get('kitchen/board', { headers: authHeader(token), params: { branchId } });
    const board = (await res.json()) as {
      orderId: string;
      items: { round: number; menuItem: { name: string } }[];
    }[];
    const tasks = board.filter((t) => t.orderId === orderId);
    // Una tarea de la ronda 1 + una de la ronda 2 (ambos productos van a la
    // misma estación de fallback en el seed, así que es una tarea por ronda).
    const rounds = new Set(tasks.flatMap((t) => t.items.map((i) => i.round)));
    expect(rounds.has(1)).toBe(true);
    expect(rounds.has(2)).toBe(true);
  });

  test('no se puede agregar a un pedido cancelado', async ({ request }) => {
    const fresh = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId: itemA.id, quantity: 1 }] },
    });
    const freshId = (await fresh.json()).id;
    // El motivo es obligatorio para cancelar (control interno anti-robo).
    await request.patch(`orders/${freshId}/status`, {
      headers: authHeader(token),
      data: { status: 'CANCELLED', reason: 'Setup del test' },
    });

    const res = await request.post(`orders/${freshId}/items`, {
      headers: authHeader(token),
      data: { items: [{ menuItemId: itemB.id, quantity: 1 }] },
    });
    expect(res.status()).toBe(409);
  });

  test('no se puede agregar a un pedido con una parte ya cobrada', async ({ request }) => {
    const fresh = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'DINE_IN', items: [{ menuItemId: itemA.id, quantity: 2 }] },
    });
    const freshOrder = await fresh.json();
    const freshId = freshOrder.id;

    // Asegurar una caja abierta y dividir la cuenta en dos.
    const openRes = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (!openRes.ok()) {
      await request.post('pos/cash-sessions/open', { headers: authHeader(token), data: { branchId, openingCash: 100000 } });
    }
    const half = Math.round((Number(freshOrder.total) / 2) * 100) / 100;
    const other = Math.round((Number(freshOrder.total) - half) * 100) / 100;
    const split = await request.post(`waiter/orders/${freshId}/split`, {
      headers: authHeader(token),
      data: { mode: 'BY_PERSON', parts: [{ label: 'A', amount: half }, { label: 'B', amount: other }] },
    });
    const parts = (await split.json()) as { id: string; amount: string }[];

    await request.post(`pos/orders/${freshId}/charge`, {
      headers: authHeader(token),
      data: {
        idempotencyKey: randomUUID(),
        billSplitId: parts[0]!.id,
        payments: [{ method: 'CASH', amount: Number(parts[0]!.amount) }],
      },
    });

    // Agregar ítems ahora descuadraría el split y el pago ya hecho.
    const res = await request.post(`orders/${freshId}/items`, {
      headers: authHeader(token),
      data: { items: [{ menuItemId: itemB.id, quantity: 1 }] },
    });
    expect(res.status()).toBe(409);
  });
});
