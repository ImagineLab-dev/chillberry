import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

const TEST_TURNSTILE_TOKEN = 'e2e-test-token';

/**
 * Notas ("sin cebolla") y extras con precio ("+queso $5.000") de punta a punta.
 *
 * Lo que realmente importa acá es que el precio lo calcule el SERVIDOR a partir
 * de los ids elegidos: el pedido por QR es anónimo, así que si el backend
 * confiara en el cliente, cualquiera con el link pagaría lo que quisiera.
 */
test.describe.serial('pedido con notas y extras -> precio correcto -> llega a cocina', () => {
  let ownerToken: string;
  let branchId: string;
  let qrToken: string;
  let menuItemId: string;
  let basePrice: number;
  let otherMenuItemId: string;
  let groupId: string;
  let cheeseOptionId: string;
  let guestOrderId: string;

  const CHEESE_DELTA = 5000;
  const QTY = 2;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);
    const branch = await getFirstBranch(request, ownerToken);
    branchId = branch.id;

    const menuItem = await getFirstMenuItem(request, ownerToken, branchId);
    menuItemId = menuItem.id;
    basePrice = Number(menuItem.price);

    const itemsRes = await request.get('menu/items', { headers: authHeader(ownerToken), params: { branchId } });
    const items = (await itemsRes.json()) as { id: string; isCombo?: boolean }[];
    // Otro producto DISTINTO y que no sea combo (un combo no acepta extras del
    // mismo modo y rompería la premisa de este test).
    otherMenuItemId = items.find((i) => !i.isCombo && i.id !== menuItemId)!.id;

    const tablesRes = await request.get('tables', { headers: authHeader(ownerToken), params: { branchId } });
    const tables = (await tablesRes.json()) as { qrToken: string }[];
    qrToken = tables[0]!.qrToken;
  });

  test.afterAll(async ({ request }) => {
    // El grupo queda activo si no se limpia y contamina los otros specs.
    if (groupId) {
      await request.delete(`menu/modifier-groups/${groupId}`, { headers: authHeader(ownerToken) });
    }
  });

  test('el admin crea un grupo de extras con opciones', async ({ request }) => {
    const groupRes = await request.post(`menu/items/${menuItemId}/modifier-groups`, {
      headers: authHeader(ownerToken),
      data: { name: 'Extras E2E', minSelect: 0, maxSelect: 3 },
    });
    expect(groupRes.ok()).toBeTruthy();
    groupId = (await groupRes.json()).id;

    const optRes = await request.post(`menu/modifier-groups/${groupId}/options`, {
      headers: authHeader(ownerToken),
      data: { name: 'Queso extra', priceDelta: CHEESE_DELTA },
    });
    expect(optRes.ok()).toBeTruthy();
    cheeseOptionId = (await optRes.json()).id;
  });

  test('rechaza crear un grupo con minSelect mayor que maxSelect', async ({ request }) => {
    const res = await request.post(`menu/items/${menuItemId}/modifier-groups`, {
      headers: authHeader(ownerToken),
      data: { name: 'Inválido', minSelect: 5, maxSelect: 2 },
    });
    expect(res.status()).toBe(400);
  });

  test('el menú público expone los grupos de extras del producto', async ({ request }) => {
    const res = await request.get(`public/menu/${qrToken}`);
    expect(res.ok()).toBeTruthy();
    const menu = await res.json();
    const item = menu.categories.flatMap((c: { items: unknown[] }) => c.items).find((i: { id: string }) => i.id === menuItemId);
    expect(item.modifierGroups.length).toBeGreaterThan(0);
    const group = item.modifierGroups.find((g: { id: string }) => g.id === groupId);
    expect(group.options.some((o: { id: string }) => o.id === cheeseOptionId)).toBe(true);
  });

  test('un extra de OTRO producto es rechazado (no se puede pagar de menos)', async ({ request }) => {
    const res = await request.post(`public/menu/${qrToken}/order`, {
      data: {
        turnstileToken: TEST_TURNSTILE_TOKEN,
        items: [{ menuItemId: otherMenuItemId, quantity: 1, modifierOptionIds: [cheeseOptionId] }],
      },
    });
    expect(res.status()).toBe(400);
  });

  test('el cliente no puede mandar su propio precio', async ({ request }) => {
    const res = await request.post(`public/menu/${qrToken}/order`, {
      data: {
        turnstileToken: TEST_TURNSTILE_TOKEN,
        items: [{ menuItemId, quantity: 1, unitPrice: 1 }],
      },
    });
    expect(res.status()).toBe(400);
  });

  test('pedido por QR con nota + extra: el servidor calcula (precio + delta) * cantidad', async ({ request }) => {
    const res = await request.post(`public/menu/${qrToken}/order`, {
      data: {
        customerName: 'Cliente E2E Extras',
        notes: 'Somos alérgicos al maní',
        turnstileToken: TEST_TURNSTILE_TOKEN,
        items: [
          { menuItemId, quantity: QTY, notes: 'sin cebolla', modifierOptionIds: [cheeseOptionId] },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    guestOrderId = body.orderId;
    expect(Number(body.total)).toBe((basePrice + CHEESE_DELTA) * QTY);
  });

  test('el estado público devuelve la nota y el snapshot del extra', async ({ request }) => {
    const res = await request.get(`public/menu/orders/${guestOrderId}/status`);
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.notes).toBe('Somos alérgicos al maní');

    const line = status.items[0];
    expect(line.notes).toBe('sin cebolla');
    expect(Number(line.unitPrice)).toBe(basePrice + CHEESE_DELTA);
    // Snapshot desnormalizado: guarda el texto y el precio del momento.
    expect(line.modifiers).toEqual([
      { groupName: 'Extras E2E', optionName: 'Queso extra', priceDelta: String(CHEESE_DELTA) },
    ]);
  });

  test('la cocina ve la nota del ítem, la del pedido y el extra', async ({ request }) => {
    const res = await request.get('kitchen/board', { headers: authHeader(ownerToken), params: { branchId } });
    expect(res.ok()).toBeTruthy();
    const board = (await res.json()) as {
      orderId: string;
      order: { notes: string | null };
      items: { notes: string | null; modifiers: unknown }[];
    }[];

    const task = board.find((t) => t.orderId === guestOrderId);
    expect(task).toBeTruthy();
    expect(task!.order.notes).toBe('Somos alérgicos al maní');

    const line = task!.items.find((i) => i.notes === 'sin cebolla');
    expect(line).toBeTruthy();
    expect(line!.modifiers).toEqual([
      { groupName: 'Extras E2E', optionName: 'Queso extra', priceDelta: String(CHEESE_DELTA) },
    ]);
  });

  test('desactivar la opción la saca del menú público pero no toca los pedidos ya hechos', async ({ request }) => {
    const del = await request.delete(`menu/modifier-options/${cheeseOptionId}`, { headers: authHeader(ownerToken) });
    expect(del.ok()).toBeTruthy();

    const menuRes = await request.get(`public/menu/${qrToken}`);
    const menu = await menuRes.json();
    const item = menu.categories.flatMap((c: { items: unknown[] }) => c.items).find((i: { id: string }) => i.id === menuItemId);
    const group = item.modifierGroups.find((g: { id: string }) => g.id === groupId);
    expect(group?.options.some((o: { id: string }) => o.id === cheeseOptionId) ?? false).toBe(false);

    // El pedido histórico conserva su snapshot — ésta es la razón de guardarlo
    // desnormalizado en vez de joinear contra la opción.
    const statusRes = await request.get(`public/menu/orders/${guestOrderId}/status`);
    const status = await statusRes.json();
    expect(status.items[0].modifiers).toEqual([
      { groupName: 'Extras E2E', optionName: 'Queso extra', priceDelta: String(CHEESE_DELTA) },
    ]);
    expect(Number(status.items[0].unitPrice)).toBe(basePrice + CHEESE_DELTA);
  });
});
