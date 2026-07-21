import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Flujo 1+2 del checklist original: mesa -> pedido -> aparece en cocina ->
 * cocina cambia estados -> el pedido agregado llega a READY.
 *
 * Nota honesta: el plan original describía este flujo como "cliente escanea
 * QR -> pedido -> confirmación", pero `POST /orders` requiere autenticación
 * de staff (@CurrentUser) — no existe todavía un endpoint público de pedido
 * anónimo por QR en esta implementación (el mesero es quien carga el pedido
 * en nombre del cliente, que es exactamente lo que la Fase 2 sí construyó y
 * verificó). Este test cubre el flujo real tal como está implementado.
 */
test.describe.serial('mesa -> pedido -> cocina -> READY', () => {
  let token: string;
  let branchId: string;
  let tableId: string;
  let orderId: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
  });

  test('abrir una mesa', async ({ request }) => {
    const branch = await getFirstBranch(request, token);
    branchId = branch.id;

    const tablesRes = await request.get('waiter/tables', {
      headers: authHeader(token),
      params: { branchId },
    });
    expect(tablesRes.ok()).toBeTruthy();
    const tables = (await tablesRes.json()) as { id: string; status: string }[];
    expect(tables.length).toBeGreaterThan(0);
    tableId = tables[0]!.id;

    const openRes = await request.post(`waiter/tables/${tableId}/open`, { headers: authHeader(token) });
    expect(openRes.ok()).toBeTruthy();
    const opened = await openRes.json();
    expect(opened.status).toBe('OCCUPIED');
  });

  test('crear el pedido para esa mesa', async ({ request }) => {
    const menuItem = await getFirstMenuItem(request, token, branchId);

    const orderRes = await request.post('orders', {
      headers: authHeader(token),
      data: {
        branchId,
        tableId,
        type: 'DINE_IN',
        items: [{ menuItemId: menuItem.id, quantity: 2 }],
      },
    });
    expect(orderRes.ok()).toBeTruthy();
    const order = await orderRes.json();
    expect(order.id).toBeTruthy();
    expect(order.status).toBe('WAITING');
    expect(Number(order.total)).toBeGreaterThan(0);
    orderId = order.id;
  });

  test('el pedido aparece en el tablero de cocina', async ({ request }) => {
    const boardRes = await request.get('kitchen/board', { headers: authHeader(token), params: { branchId } });
    expect(boardRes.ok()).toBeTruthy();
    const board = (await boardRes.json()) as { id: string; status: string; orderId: string }[];
    const tasksForOrder = board.filter((t) => t.orderId === orderId);
    expect(tasksForOrder.length).toBeGreaterThan(0);
    expect(tasksForOrder.every((t) => t.status === 'NEW')).toBe(true);
  });

  test('cocina avanza cada tarea a IN_PROGRESS y luego READY -> el pedido agregado llega a READY', async ({
    request,
  }) => {
    const boardRes = await request.get('kitchen/board', { headers: authHeader(token), params: { branchId } });
    const board = (await boardRes.json()) as { id: string; orderId: string }[];
    const taskIds = board.filter((t) => t.orderId === orderId).map((t) => t.id);
    expect(taskIds.length).toBeGreaterThan(0);

    for (const taskId of taskIds) {
      const inProgress = await request.patch(`kitchen/tasks/${taskId}/status`, {
        headers: authHeader(token),
        data: { status: 'IN_PROGRESS' },
      });
      expect(inProgress.ok()).toBeTruthy();
    }

    const midOrderRes = await request.get(`orders/${orderId}`, { headers: authHeader(token) });
    const midOrder = await midOrderRes.json();
    expect(midOrder.status).toBe('PREPARING');

    for (const taskId of taskIds) {
      const ready = await request.patch(`kitchen/tasks/${taskId}/status`, {
        headers: authHeader(token),
        data: { status: 'READY' },
      });
      expect(ready.ok()).toBeTruthy();
    }

    const finalOrderRes = await request.get(`orders/${orderId}`, { headers: authHeader(token) });
    const finalOrder = await finalOrderRes.json();
    expect(finalOrder.status).toBe('READY');
  });
});
