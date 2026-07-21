import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

// Con `TURNSTILE_SECRET_KEY` en su default de sandbox, cualquier `response`
// llega a `success:true` en el siteverify real de Cloudflare.
const TEST_TURNSTILE_TOKEN = 'e2e-test-token';

/** Hoy en la zona horaria del tenant, formato 'YYYY-MM-DD'. La franja de cierre
 *  se evalúa server-side en esa zona, así que el test tiene que usar la misma. */
function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Carta pública COMPARTIBLE de la sucursal (`/r/:slug`, la de la bio de
 * Instagram/WhatsApp): el cliente elige delivery o retiro, paga al recibir, y
 * el pedido llega a cocina igual que cualquier otro. A diferencia del QR de
 * mesa (04), acá NO hay mesa y el tipo de pedido lo elige el cliente.
 */
test.describe.serial('carta pública por sucursal -> delivery / retiro -> paga al recibir -> cocina', () => {
  let ownerToken: string;
  let branchId: string;
  let secondBranchId: string | null = null;
  let menuItemId: string;
  let itemPrice: number;
  let timezone: string;
  // Slug único por corrida: el slug es único global, si lo dejáramos fijo la
  // segunda corrida chocaría con la primera.
  const slug = `e2e-carta-${Date.now()}`;
  const DELIVERY_FEE = 12000;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);

    const branch = await getFirstBranch(request, ownerToken);
    branchId = branch.id;
    const item = await getFirstMenuItem(request, ownerToken, branchId);
    menuItemId = item.id;
    itemPrice = Number(item.price);

    const tzRes = await request.get('tenant-settings', { headers: authHeader(ownerToken) });
    timezone = ((await tzRes.json()) as { timezone: string }).timezone;

    const branchesRes = await request.get('branches', { headers: authHeader(ownerToken) });
    const branches = (await branchesRes.json()) as { id: string }[];
    secondBranchId = branches.find((b) => b.id !== branchId)?.id ?? null;
  });

  test('configura el link público de la sucursal', async ({ request }) => {
    const res = await request.patch(`branches/${branchId}`, {
      headers: authHeader(ownerToken),
      data: {
        publicSlug: slug,
        publicOrderingEnabled: true,
        acceptsDelivery: true,
        acceptsPickup: true,
        deliveryFee: DELIVERY_FEE,
      },
    });
    expect(res.ok()).toBeTruthy();
    // Sin horarios cargados = siempre abierta (enforcement opt-in). Garantizamos
    // el estado por si una corrida previa dejó horarios cargados.
    const hoursRes = await request.put(`branches/${branchId}/hours`, {
      headers: authHeader(ownerToken),
      data: { hours: [] },
    });
    expect(hoursRes.ok()).toBeTruthy();
  });

  test('el menú público resuelve por slug con la config de pedido online', async ({ request }) => {
    const res = await request.get(`public/menu/branch/${slug}`);
    expect(res.ok()).toBeTruthy();
    const menu = await res.json();
    expect(menu.canOrder).toBe(true);
    expect(menu.acceptsDelivery).toBe(true);
    expect(menu.acceptsPickup).toBe(true);
    expect(menu.isOpenNow).toBe(true);
    expect(Number(menu.deliveryFee)).toBe(DELIVERY_FEE);
    expect(Array.isArray(menu.categories)).toBe(true);
  });

  test('slug inexistente -> 404', async ({ request }) => {
    const res = await request.get('public/menu/branch/no-existe-jamas-999');
    expect(res.status()).toBe(404);
  });

  let pickupOrderId: string;

  test('pedido de RETIRO: crea TAKEAWAY, sin fee, sin delivery', async ({ request }) => {
    const res = await request.post(`public/menu/branch/${slug}/order`, {
      data: {
        fulfillment: 'PICKUP',
        customerName: 'Retiro E2E',
        customerPhone: '+595981000101',
        turnstileToken: TEST_TURNSTILE_TOKEN,
        items: [{ menuItemId, quantity: 2 }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.fulfillment).toBe('PICKUP');
    expect(body.deliveryId).toBeUndefined();
    expect(body.status).toBe('WAITING');
    // Sin fee: total = precio * cantidad.
    expect(Number(body.total)).toBe(itemPrice * 2);
    pickupOrderId = body.orderId;
  });

  test('el pedido de retiro llegó a la cocina', async ({ request }) => {
    const boardRes = await request.get('kitchen/board', {
      headers: authHeader(ownerToken),
      params: { branchId },
    });
    const board = (await boardRes.json()) as { orderId: string; status: string }[];
    const tasks = board.filter((t) => t.orderId === pickupOrderId);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.status === 'NEW')).toBe(true);
  });

  let deliveryOrderId: string;
  let deliveryId: string;

  test('pedido de DELIVERY: crea DELIVERY, suma el fee, devuelve deliveryId', async ({ request }) => {
    const res = await request.post(`public/menu/branch/${slug}/order`, {
      data: {
        fulfillment: 'DELIVERY',
        customerName: 'Delivery E2E',
        customerPhone: '+595981000102',
        address: 'Av. Mcal. López 1234, Asunción',
        turnstileToken: TEST_TURNSTILE_TOKEN,
        items: [{ menuItemId, quantity: 1 }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.fulfillment).toBe('DELIVERY');
    expect(body.deliveryId).toBeTruthy();
    // El total incluye el envío: precio * 1 + fee.
    expect(Number(body.total)).toBe(itemPrice + DELIVERY_FEE);
    deliveryOrderId = body.orderId;
    deliveryId = body.deliveryId;
  });

  test('el pedido de delivery también llegó a la cocina', async ({ request }) => {
    const boardRes = await request.get('kitchen/board', {
      headers: authHeader(ownerToken),
      params: { branchId },
    });
    const board = (await boardRes.json()) as { orderId: string }[];
    expect(board.filter((t) => t.orderId === deliveryOrderId).length).toBeGreaterThan(0);
  });

  test('el delivery quedó asociado al pedido y rastreable', async ({ request }) => {
    // El estado del pedido es consultable públicamente por orderId.
    const statusRes = await request.get(`public/menu/orders/${deliveryOrderId}/status`);
    expect(statusRes.ok()).toBeTruthy();
    // El deliveryId devuelto es el que el front usa para /track/:id.
    expect(deliveryId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('DELIVERY sin dirección -> 400', async ({ request }) => {
    const res = await request.post(`public/menu/branch/${slug}/order`, {
      data: {
        fulfillment: 'DELIVERY',
        customerName: 'Sin Dir',
        customerPhone: '+595981000103',
        turnstileToken: TEST_TURNSTILE_TOKEN,
        items: [{ menuItemId, quantity: 1 }],
      },
    });
    expect(res.status()).toBe(400);
  });

  test('un día marcado cerrado bloquea el pedido, y al quitarlo vuelve a abrir', async ({ request }) => {
    const today = todayInZone(timezone);

    const closeRes = await request.post(`branches/${branchId}/closures`, {
      headers: authHeader(ownerToken),
      data: { date: today, reason: 'Cierre E2E' },
    });
    expect(closeRes.ok()).toBeTruthy();
    const closureId = (await closeRes.json()).id as string;

    // La carta ahora se ve cerrada...
    const menu = await (await request.get(`public/menu/branch/${slug}`)).json();
    expect(menu.isOpenNow).toBe(false);
    expect(menu.closedReason).toBe('closed_date');

    // ...y el pedido se rechaza server-side (no alcanza con la UI).
    const blocked = await request.post(`public/menu/branch/${slug}/order`, {
      data: {
        fulfillment: 'PICKUP',
        customerName: 'Cerrado',
        customerPhone: '+595981000104',
        turnstileToken: TEST_TURNSTILE_TOKEN,
        items: [{ menuItemId, quantity: 1 }],
      },
    });
    expect(blocked.status()).toBe(400);

    // Al quitar el cierre, vuelve a aceptar pedidos.
    const del = await request.delete(`branches/${branchId}/closures/${closureId}`, {
      headers: authHeader(ownerToken),
    });
    expect(del.ok()).toBeTruthy();
    const reopened = await (await request.get(`public/menu/branch/${slug}`)).json();
    expect(reopened.isOpenNow).toBe(true);
  });

  test('horario con cierre <= apertura -> 400', async ({ request }) => {
    const res = await request.put(`branches/${branchId}/hours`, {
      headers: authHeader(ownerToken),
      data: { hours: [{ weekday: 3, openMinute: 1200, closeMinute: 200 }] },
    });
    expect(res.status()).toBe(400);
  });

  test('el slug es único global: reusarlo en otra sucursal -> 409', async ({ request }) => {
    test.skip(secondBranchId === null, 'El seed no tiene una segunda sucursal');
    const res = await request.patch(`branches/${secondBranchId}`, {
      headers: authHeader(ownerToken),
      data: { publicSlug: slug },
    });
    expect(res.status()).toBe(409);
  });
});
