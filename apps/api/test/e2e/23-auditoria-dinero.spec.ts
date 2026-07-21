import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Regresiones de la auditoría del 21/07/2026 — bugs de dinero.
 *
 * C1: quitar un ítem dos veces (doble tap del mozo) restaba el total dos veces.
 * A1: cobrar el total de una cuenta dividida sin elegir la parte dejaba el
 *     pedido trabado para siempre.
 */
test.describe.serial('auditoría: bugs de dinero', () => {
  let token: string;
  let branchId: string;
  let itemA: { id: string; price: string };
  let itemB: { id: string; price: string };

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    itemA = await getFirstMenuItem(request, token, branchId);
    const items = (await (
      await request.get('menu/items', { headers: authHeader(token), params: { branchId } })
    ).json()) as { id: string; price: string }[];
    itemB = items[1]!;
  });

  async function abrirCaja(request: import('@playwright/test').APIRequestContext) {
    const abierta = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (abierta.ok()) {
      const b = await abierta.json();
      if (b?.id) return;
    }
    await request.post('pos/cash-sessions/open', { headers: authHeader(token), data: { branchId, openingCash: 100000 } });
  }

  // ---------------------------------------------------------------------- C1

  test('C1: dos taps CONCURRENTES sobre el mismo ítem restan el total una sola vez', async ({ request }) => {
    const creado = await request.post('orders', {
      headers: authHeader(token),
      data: {
        branchId,
        type: 'TAKEAWAY',
        items: [
          { menuItemId: itemA.id, quantity: 1 },
          { menuItemId: itemB.id, quantity: 1 },
        ],
      },
    });
    expect(creado.ok(), await creado.text()).toBeTruthy();
    const order = (await creado.json()) as { id: string; total: string; items: { id: string; menuItemId: string }[] };
    const item = order.items.find((i) => i.menuItemId === itemA.id)!;

    // Dos deletes del MISMO ítem, en paralelo: la carrera real del doble tap.
    // Sin el guard del count, ambos restaban y el total caía a ~itemB - itemA.
    await Promise.all([
      request.delete(`orders/${order.id}/items/${item.id}`, { headers: authHeader(token) }),
      request.delete(`orders/${order.id}/items/${item.id}`, { headers: authHeader(token) }),
    ]);

    const final = await request.get(`orders/${order.id}`, { headers: authHeader(token) });
    const cuerpo = (await final.json()) as { total: string; items: { menuItemId: string }[] };
    // Sea cual sea el orden en que se intercalen, el ítem se quita una vez y el
    // total queda en el precio del que sobró — nunca por debajo.
    expect(cuerpo.items).toHaveLength(1);
    expect(Number(cuerpo.total), 'el total no puede bajar de más').toBe(Number(itemB.price));
  });

  // ---------------------------------------------------------------------- C2

  test('C2: al fusionar mesas, las comandas de cocina no desaparecen', async ({ request }) => {
    // Dos mesas libres del salón.
    const mesas = (await (
      await request.get('tables', { headers: authHeader(token), params: { branchId } })
    ).json()) as { id: string; code: string; status: string }[];
    const libres = mesas.filter((m) => m.status === 'AVAILABLE' && m.active !== false);
    test.skip(libres.length < 2, 'hacen falta 2 mesas libres');
    const [mesa1, mesa2] = libres;

    // Un pedido en cada una — cada uno genera su comanda en cocina.
    const o1 = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'DINE_IN', tableId: mesa1!.id, items: [{ menuItemId: itemA.id, quantity: 1 }] },
    });
    const o2 = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'DINE_IN', tableId: mesa2!.id, items: [{ menuItemId: itemB.id, quantity: 1 }] },
    });
    expect(o1.ok() && o2.ok(), 'los dos pedidos se crean').toBeTruthy();
    const order2Id = (await o2.json()).id as string;

    // Fusión: mesa1 primaria, mesa2 secundaria (su pedido se cancela).
    const merge = await request.post('waiter/tables/merge', {
      headers: authHeader(token),
      data: { tableIds: [mesa1!.id, mesa2!.id] },
    });
    expect(merge.ok(), `la fusión tiene que entrar: ${await merge.text()}`).toBeTruthy();

    // El board NO debe haber perdido la comanda de la mesa fusionada. Antes, la
    // KitchenTask quedaba en el pedido secundario (cancelado) y el filtro del
    // board la escondía: el plato existía en la cuenta pero nunca llegaba a cocina.
    const board = (await (
      await request.get('kitchen/board', { headers: authHeader(token), params: { branchId } })
    ).json()) as { orderId: string; items: { menuItem: { id: string } }[] }[];

    const platoFusionadoVisible = board.some((t) => t.items.some((i) => i.menuItem.id === itemB.id));
    expect(platoFusionadoVisible, 'el plato de la mesa fusionada tiene que seguir en cocina').toBe(true);

    // Y ya no cuelga del pedido secundario (que quedó cancelado).
    const enSecundario = board.some((t) => t.orderId === order2Id);
    expect(enSecundario, 'la comanda ya no debe estar bajo el pedido cancelado').toBe(false);
  });

  // ---------------------------------------------------------------------- A1

  test('A1: cobrar el total de una cuenta dividida (sin elegir parte) cierra el pedido', async ({ request }) => {
    await abrirCaja(request);

    const creado = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId: itemA.id, quantity: 4 }] },
    });
    const order = (await creado.json()) as { id: string; total: string };

    // Se divide en dos partes...
    const mitad = Math.round((Number(order.total) / 2) * 100) / 100;
    const otra = Math.round((Number(order.total) - mitad) * 100) / 100;
    const split = await request.post(`waiter/orders/${order.id}/split`, {
      headers: authHeader(token),
      data: { mode: 'BY_PERSON', parts: [{ label: 'A', amount: mitad }, { label: 'B', amount: otra }] },
    });
    expect(split.ok(), await split.text()).toBeTruthy();

    // ...pero se cobra TODO junto en efectivo, sin billSplitId.
    const cobro = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(order.total) }] },
    });
    expect(cobro.ok(), `el cobro del total tiene que entrar: ${await cobro.text()}`).toBeTruthy();

    // Antes: el pedido quedaba abierto para siempre (los splits nunca se marcan).
    // Ahora: como lo aprobado cubre el total, se cierra.
    const estado = await request.get(`orders/${order.id}`, { headers: authHeader(token) });
    expect((await estado.json()).status, 'el pedido tiene que quedar COMPLETED').toBe('COMPLETED');
  });
});
