import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

// Con `TURNSTILE_SECRET_KEY` en su default de sandbox, cualquier valor de
// `response` llega a `success:true` en el siteverify real de Cloudflare.
const TEST_TURNSTILE_TOKEN = 'e2e-test-token';

/**
 * Flujo agregado a pedido del usuario: el cliente escanea el QR de la mesa
 * y pide directo, SIN pasar por un mesero — el pedido tiene que llegar a
 * cocina igual que cualquier otro. Todo acá corre sin token de auth
 * (excepto el setup inicial, que usa el owner para leer datos de catálogo).
 */
test.describe.serial('cliente escanea QR -> arma pedido -> confirma sin login -> llega a cocina', () => {
  let ownerToken: string;
  let branchId: string;
  let qrToken: string;
  let menuItemId: string;
  let guestOrderId: string;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);
  });

  test('el menú público resuelve por qrToken y permite pedir', async ({ request }) => {
    const branch = await getFirstBranch(request, ownerToken);
    branchId = branch.id;
    const menuItem = await getFirstMenuItem(request, ownerToken, branchId);
    menuItemId = menuItem.id;

    const tablesRes = await request.get('tables', { headers: authHeader(ownerToken), params: { branchId } });
    const tables = (await tablesRes.json()) as { qrToken: string }[];
    expect(tables.length).toBeGreaterThan(0);
    qrToken = tables[0]!.qrToken;

    const menuRes = await request.get(`public/menu/${qrToken}`);
    expect(menuRes.ok()).toBeTruthy();
    const menu = await menuRes.json();
    expect(menu.canOrder).toBe(true);
    expect(Array.isArray(menu.categories)).toBe(true);
  });

  test('rechaza un producto inexistente en el carrito', async ({ request }) => {
    const res = await request.post(`public/menu/${qrToken}/order`, {
      data: {
        items: [{ menuItemId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
        turnstileToken: TEST_TURNSTILE_TOKEN,
      },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test('confirma el pedido SIN ningún token de autenticación', async ({ request }) => {
    const res = await request.post(`public/menu/${qrToken}/order`, {
      data: {
        customerName: 'Cliente E2E QR',
        items: [{ menuItemId, quantity: 3 }],
        turnstileToken: TEST_TURNSTILE_TOKEN,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.orderId).toBeTruthy();
    expect(body.status).toBe('WAITING');
    expect(Number(body.total)).toBeGreaterThan(0);
    guestOrderId = body.orderId;
  });

  test('el estado del pedido se puede consultar públicamente', async ({ request }) => {
    const res = await request.get(`public/menu/orders/${guestOrderId}/status`);
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.id).toBe(guestOrderId);
    expect(status.items).toHaveLength(1);
    expect(status.items[0].quantity).toBe(3);
  });

  test('el pedido llegó de verdad a la cocina como una tarea NEW', async ({ request }) => {
    const boardRes = await request.get('kitchen/board', { headers: authHeader(ownerToken), params: { branchId } });
    expect(boardRes.ok()).toBeTruthy();
    const board = (await boardRes.json()) as { orderId: string; status: string }[];
    const tasksForOrder = board.filter((t) => t.orderId === guestOrderId);
    expect(tasksForOrder.length).toBeGreaterThan(0);
    expect(tasksForOrder.every((t) => t.status === 'NEW')).toBe(true);
  });

  test('la mesa quedó marcada OCCUPIED', async ({ request }) => {
    const tablesRes = await request.get('tables', { headers: authHeader(ownerToken), params: { branchId } });
    const tables = (await tablesRes.json()) as { qrToken: string; status: string }[];
    const table = tables.find((t) => t.qrToken === qrToken);
    expect(table?.status).toBe('OCCUPIED');
  });
});
