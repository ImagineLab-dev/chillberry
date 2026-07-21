import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { authHeader, getFirstBranch, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Reportes de ventas + margen (food cost). Lo importante a fijar: el margen se
 * calcula bien cuando hay costo, y NO se infla cuando falta —un producto sin
 * costo cargado reporta `margin: null`, no "100% ganancia".
 */
test.describe.serial('reportes de ventas y margen', () => {
  let token: string;
  let branchId: string;
  let categoryId: string | undefined;
  let withCostId: string;
  let noCostId: string;

  const PRICE = 20000;
  const COST = 8000; // margen esperado por unidad: 12000 (60%)

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    const cats = await request.get('menu/categories', { headers: authHeader(token), params: { branchId } });
    categoryId = (await cats.json())[0]?.id;
  });

  async function createProduct(request: import('@playwright/test').APIRequestContext, name: string, cost?: number) {
    const res = await request.post('menu/items', {
      headers: authHeader(token),
      data: { branchId, categoryId, name, price: PRICE, ...(cost !== undefined ? { cost } : {}) },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).id as string;
  }

  async function sellOne(request: import('@playwright/test').APIRequestContext, menuItemId: string) {
    const order = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId, quantity: 1 }] },
    });
    const orderId = (await order.json()).id;
    const open = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (!(open.ok() && (await open.json())?.id)) {
      await request.post('pos/cash-sessions/open', { headers: authHeader(token), data: { branchId, openingCash: 100000 } });
    }
    await request.post(`pos/orders/${orderId}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: PRICE }] },
    });
  }

  test('crear un producto con costo y otro sin costo, y vender uno de cada uno', async ({ request }) => {
    const tag = Date.now();
    withCostId = await createProduct(request, `Margen-con-costo-${tag}`, COST);
    noCostId = await createProduct(request, `Margen-sin-costo-${tag}`);
    await sellOne(request, withCostId);
    await sellOne(request, noCostId);
    expect(withCostId).toBeTruthy();
    expect(noCostId).toBeTruthy();
  });

  test('el producto CON costo reporta el margen correcto', async ({ request }) => {
    const res = await request.get('reports/sales', { headers: authHeader(token), params: { branchId } });
    expect(res.ok()).toBeTruthy();
    const report = await res.json();

    const withCost = report.topByRevenue.find((p: { name: string }) => p.name.startsWith('Margen-con-costo-'));
    expect(withCost).toBeTruthy();
    // Vendí 1 unidad: margen = precio - costo.
    expect(withCost.margin).toBe(PRICE - COST);
  });

  test('el producto SIN costo reporta margin=null (no se infla)', async ({ request }) => {
    const res = await request.get('reports/sales', { headers: authHeader(token), params: { branchId } });
    const report = await res.json();

    const noCost = report.topByRevenue.find((p: { name: string }) => p.name.startsWith('Margen-sin-costo-'));
    expect(noCost).toBeTruthy();
    expect(noCost.margin).toBeNull();
    // Y no aparece en la lista de rentabilidad (que solo tiene márgenes reales).
    expect(report.topByMargin.some((p: { name: string }) => p.name.startsWith('Margen-sin-costo-'))).toBe(false);
    // El resumen avisa que hay productos sin costo.
    expect(report.summary.productsWithoutCost).toBeGreaterThan(0);
  });

  test.afterAll(async ({ request }) => {
    // Desactivar los productos de prueba para no ensuciar el menú del seed.
    for (const id of [withCostId, noCostId]) {
      if (id) await request.delete(`menu/items/${id}`, { headers: authHeader(token) });
    }
  });
});
