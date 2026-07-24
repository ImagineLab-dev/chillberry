import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { login, OWNER_CREDENTIALS, authHeader, getFirstBranch, getFirstMenuItem } from './helpers';

const prisma = new PrismaClient();
const stamp = Date.now().toString().slice(-9);
const emailMozo = `e2e-mozo-sucursal-${stamp}@chillberry-demo.test`;

test.afterAll(async () => {
  // Mejor esfuerzo: si el mozo llegó a cargar un pedido tiene historial y el
  // borrado duro tira 409 — no importa, es la base de dev.
  await prisma.user.deleteMany({ where: { email: emailMozo.toLowerCase() } }).catch(() => {});
  await prisma.$disconnect();
});

/**
 * Venta de mostrador ("Nueva venta" en la caja).
 *
 * Un pedido creado SIN mesa es una venta de mostrador y tiene que guardarse
 * como TAKEAWAY, no como DINE_IN. Antes caía siempre a DINE_IN (default), así
 * que una venta de mostrador quedaba registrada como "en mesa" sin mesa —
 * inconsistente y ensuciaba los reportes por tipo de pedido.
 *
 * Además, aparece en la lista de pendientes de la caja para poder cobrarlo.
 */
test.describe('venta de mostrador (pedido sin mesa)', () => {
  test('un pedido sin mesa se guarda como TAKEAWAY y aparece en pendientes', async ({ request }) => {
    const token = await login(request, OWNER_CREDENTIALS);
    const branch = await getFirstBranch(request, token);
    const item = await getFirstMenuItem(request, token, branch.id);

    const res = await request.post('orders', {
      headers: authHeader(token),
      // Sin tableId: es una venta de mostrador.
      data: {
        branchId: branch.id,
        customerName: 'Cliente Mostrador',
        items: [{ menuItemId: item.id, quantity: 1 }],
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const order = (await res.json()) as { id: string; type: string; tableId: string | null };

    // Lo importante del fix: sin mesa → TAKEAWAY (no DINE_IN).
    expect(order.type).toBe('TAKEAWAY');
    expect(order.tableId).toBeFalsy();

    // Y está disponible para cobrar en la caja (lista de pendientes por sucursal).
    const pend = await request.get('pos/orders/pending', {
      headers: authHeader(token),
      params: { branchId: branch.id },
    });
    expect(pend.ok()).toBeTruthy();
    const pendientes = (await pend.json()) as Array<{ id: string }>;
    expect(pendientes.some((o) => o.id === order.id)).toBeTruthy();
  });

  test('un pedido CON mesa sigue siendo DINE_IN (no rompimos el default)', async ({ request }) => {
    const token = await login(request, OWNER_CREDENTIALS);
    const branch = await getFirstBranch(request, token);
    const item = await getFirstMenuItem(request, token, branch.id);

    // Se busca una mesa de la sucursal para el caso con mesa.
    const tablesRes = await request.get('tables', { headers: authHeader(token), params: { branchId: branch.id } });
    expect(tablesRes.ok()).toBeTruthy();
    const tables = (await tablesRes.json()) as Array<{ id: string }>;
    test.skip(tables.length === 0, 'no hay mesas cargadas en la sucursal demo');

    const res = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId: branch.id, tableId: tables[0]!.id, items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const order = (await res.json()) as { type: string };
    expect(order.type).toBe('DINE_IN');
  });
});

/**
 * Aislamiento por sucursal al CREAR pedidos.
 *
 * Un empleado atado a un local (mozo/cajero) sólo puede crear pedidos en el
 * suyo. Antes el `branchId` venía del body sin control: podía cargar una venta
 * en la sucursal de al lado. El dueño sigue pudiendo operar en cualquiera.
 */
test.describe('un empleado atado a su sucursal sólo crea pedidos ahí', () => {
  const CLAVE = 'Chillberry123!';

  test('el mozo de una sucursal no puede crear un pedido en otra', async ({ request }) => {
    const ownerToken = await login(request, OWNER_CREDENTIALS);

    const branchesRes = await request.get('branches', { headers: authHeader(ownerToken) });
    const branches = (await branchesRes.json()) as Array<{ id: string }>;
    test.skip(branches.length < 2, 'se necesitan al menos 2 sucursales en la demo');
    const propia = branches[0]!;
    const ajena = branches[1]!;

    // El dueño crea un mozo ATADO a `propia`.
    const crear = await request.post('users', {
      headers: authHeader(ownerToken),
      data: { name: 'E2E Mozo Sucursal', email: emailMozo, password: CLAVE, role: 'WAITER', branchId: propia.id },
    });
    expect(crear.ok(), await crear.text()).toBeTruthy();

    const mozoToken = await login(request, { email: emailMozo, password: CLAVE });
    const item = await getFirstMenuItem(request, mozoToken, propia.id);

    // En OTRA sucursal → 403, y no se crea nada.
    const ajeno = await request.post('orders', {
      headers: authHeader(mozoToken),
      data: { branchId: ajena.id, items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    expect(ajeno.status()).toBe(403);

    // En la SUYA → sí (no lo bloqueamos de más).
    const propio = await request.post('orders', {
      headers: authHeader(mozoToken),
      data: { branchId: propia.id, items: [{ menuItemId: item.id, quantity: 1 }] },
    });
    expect(propio.ok(), await propio.text()).toBeTruthy();
  });
});
