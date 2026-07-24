import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Cobertura que la auditoría del 22/07/2026 marcó como faltante: reembolsos
 * (plata que sale del cajón, sin UN solo test), cupones (módulo entero sin
 * spec) y el CAJERO como actor real (la pantalla POS entera depende de sus
 * @Roles y ninguna regresión ahí la detectaba nada).
 */
const prisma = new PrismaClient();
const stamp = Date.now().toString().slice(-9);
const emailCajero = `e2e-cajero-${stamp}@chillberry-demo.test`;
const CLAVE = 'Chillberry123!';

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: emailCajero.toLowerCase() } }).catch(() => {});
  await prisma.$disconnect();
});

test.describe.serial('refund, cupones y cajero', () => {
  let token: string;
  let branchId: string;
  let menuItemId: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    const branch = await getFirstBranch(request, token);
    branchId = branch.id;
    const item = await getFirstMenuItem(request, token, branchId);
    menuItemId = item.id;
  });

  async function createOrder(request: import('@playwright/test').APIRequestContext, quantity = 2) {
    const res = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId, quantity }] },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as { id: string; total: string };
  }

  async function ensureOpenSession(request: import('@playwright/test').APIRequestContext) {
    const existing = await request.get('pos/cash-sessions/open', { headers: authHeader(token), params: { branchId } });
    if (existing.ok()) {
      const body = await existing.json();
      if (body?.id) return;
    }
    await request.post('pos/cash-sessions/open', {
      headers: authHeader(token),
      data: { branchId, openingCash: 100000 },
    });
  }

  async function cobrar(request: import('@playwright/test').APIRequestContext, order: { id: string; total: string }) {
    const res = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(order.total) }] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }

  // ----------------------------------------------------------------- refund

  test('refund: no se puede reembolsar un pedido sin cobrar', async ({ request }) => {
    const order = await createOrder(request);
    const res = await request.post(`pos/orders/${order.id}/refund`, {
      headers: authHeader(token),
      data: { amount: 10, reason: 'Prueba inválida' },
    });
    expect(res.status()).toBe(409);
  });

  test('refund parcial + resto = total; y NUNCA más de lo pagado', async ({ request }) => {
    const order = await createOrder(request);
    await ensureOpenSession(request);
    await cobrar(request, order);

    const total = Number(order.total);
    const mitad = Math.round((total / 2) * 100) / 100;

    // Parcial: no marca el pedido como totalmente reembolsado.
    const r1 = await request.post(`pos/orders/${order.id}/refund`, {
      headers: authHeader(token),
      data: { amount: mitad, reason: 'Plato mal servido' },
    });
    expect(r1.ok(), await r1.text()).toBeTruthy();
    const b1 = (await r1.json()) as { fullyRefunded: boolean; totalRefunded: number };
    expect(b1.fullyRefunded).toBe(false);
    expect(b1.totalRefunded).toBeCloseTo(mitad, 1);

    // Pasarse del saldo restante se rechaza (proteger el cajón).
    const exceso = await request.post(`pos/orders/${order.id}/refund`, {
      headers: authHeader(token),
      data: { amount: total, reason: 'Intento de más' },
    });
    expect(exceso.ok()).toBeFalsy();

    // El resto exacto: ahora sí queda totalmente reembolsado.
    const r2 = await request.post(`pos/orders/${order.id}/refund`, {
      headers: authHeader(token),
      data: { amount: Math.round((total - mitad) * 100) / 100, reason: 'Devolución completa' },
    });
    expect(r2.ok(), await r2.text()).toBeTruthy();
    const b2 = (await r2.json()) as { fullyRefunded: boolean; totalRefunded: number };
    expect(b2.fullyRefunded).toBe(true);
    expect(b2.totalRefunded).toBeCloseTo(total, 1);
  });

  // ---------------------------------------------------------------- cupones

  test('cupón de un solo uso: descuenta una vez y el segundo canje se rechaza', async ({ request }) => {
    const code = `E2E${stamp.slice(-6)}`;
    const crear = await request.post('coupons', {
      headers: authHeader(token),
      data: { code, discountType: 'PERCENTAGE', value: 10, maxUses: 1 },
    });
    expect(crear.ok(), await crear.text()).toBeTruthy();

    // Canje 1: el monto lo resuelve el server desde el cupón (value: 0 es
    // relleno del DTO compartido, nunca se confía en él).
    const o1 = await createOrder(request);
    const d1 = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: o1.id, type: 'COUPON', value: 0, couponCode: code, reason: 'Cupón del cliente' },
    });
    expect(d1.ok(), await d1.text()).toBeTruthy();
    const t1 = Number(((await (await request.get(`orders/${o1.id}`, { headers: authHeader(token) })).json()) as { total: string }).total);
    expect(t1).toBeCloseTo(Number(o1.total) * 0.9, 1);

    // Canje 2 (otro pedido): agotado — maxUses es una guarda atómica.
    const o2 = await createOrder(request);
    const d2 = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: o2.id, type: 'COUPON', value: 0, couponCode: code, reason: 'Reuso inválido' },
    });
    expect(d2.ok()).toBeFalsy();
  });

  // ----------------------------------------------------------------- cajero

  test('el CAJERO puede operar su superficie completa', async ({ request }) => {
    const alta = await request.post('users', {
      headers: authHeader(token),
      data: { name: 'E2E Cajero', email: emailCajero, password: CLAVE, role: 'CASHIER', branchId },
    });
    expect(alta.ok(), await alta.text()).toBeTruthy();
    const cajero = await login(request, { email: emailCajero, password: CLAVE });

    // Lo que SÍ: menú (para la venta de mostrador), crear pedido, pendientes, cobrar.
    const menu = await request.get('menu/items', { headers: authHeader(cajero), params: { branchId } });
    expect(menu.ok(), await menu.text()).toBeTruthy();

    const venta = await request.post('orders', {
      headers: authHeader(cajero),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId, quantity: 1 }] },
    });
    expect(venta.ok(), await venta.text()).toBeTruthy();
    const pedido = (await venta.json()) as { id: string; total: string };

    const pendientes = await request.get('pos/orders/pending', {
      headers: authHeader(cajero),
      params: { branchId },
    });
    expect(pendientes.ok()).toBeTruthy();
    expect(((await pendientes.json()) as Array<{ id: string }>).some((o) => o.id === pedido.id)).toBeTruthy();

    await ensureOpenSession(request);
    const cobro = await request.post(`pos/orders/${pedido.id}/charge`, {
      headers: authHeader(cajero),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(pedido.total) }] },
    });
    expect(cobro.ok(), await cobro.text()).toBeTruthy();

    // Lo que NO: gestión del equipo, listado transversal de pedidos, cupones.
    expect((await request.get('users', { headers: authHeader(cajero) })).status()).toBe(403);
    expect((await request.get('orders', { headers: authHeader(cajero), params: { branchId } })).status()).toBe(403);
    expect((await request.get('coupons', { headers: authHeader(cajero) })).status()).toBe(403);
  });

  test('el cajero NO ve productos desactivados ni con includeInactive=true', async ({ request }) => {
    const cajero = await login(request, { email: emailCajero, password: CLAVE });

    // El owner desactiva un producto y lo restaura al final, pase lo que pase.
    const patch = await request.patch(`menu/items/${menuItemId}`, {
      headers: authHeader(token),
      data: { active: false },
    });
    expect(patch.ok(), await patch.text()).toBeTruthy();
    try {
      const deOwner = (await (
        await request.get('menu/items', { headers: authHeader(token), params: { branchId, includeInactive: 'true' } })
      ).json()) as Array<{ id: string }>;
      expect(deOwner.some((i) => i.id === menuItemId)).toBeTruthy();

      // EL BUG (BAJO de la auditoría): el flag lo respetaba cualquiera — un
      // cajero veía el menú desactivado. Ahora el flag es sólo owner/admin.
      const deCajero = (await (
        await request.get('menu/items', { headers: authHeader(cajero), params: { branchId, includeInactive: 'true' } })
      ).json()) as Array<{ id: string }>;
      expect(deCajero.some((i) => i.id === menuItemId)).toBeFalsy();
    } finally {
      await request.patch(`menu/items/${menuItemId}`, { headers: authHeader(token), data: { active: true } });
    }
  });

  // ------------------------------------------------- repartidor con perfil

  test('crear un usuario DRIVER crea también su perfil de repartidor', async ({ request }) => {
    const emailDriver = `e2e-driver-perfil-${stamp}@chillberry-demo.test`;
    const alta = await request.post('users', {
      headers: authHeader(token),
      data: { name: 'E2E Repartidor', email: emailDriver, password: CLAVE, role: 'DRIVER', phone: '+595981000111' },
    });
    expect(alta.ok(), await alta.text()).toBeTruthy();
    const creado = (await alta.json()) as { id: string };

    // EL BUG (primer uso real, 22/07): el usuario DRIVER quedaba SIN perfil de
    // Driver → su pantalla daba 404 en todo, no aparecía para asignar entregas
    // y el delivery quedaba PENDING para siempre.
    const perfil = await prisma.driver.findFirst({ where: { userId: creado.id } });
    expect(perfil, 'el perfil de Driver tiene que crearse junto con el usuario').not.toBeNull();
    expect(perfil!.availability).toBe('OFFLINE');

    // Y su pantalla funciona: /delivery/drivers/me responde con el perfil.
    const driverToken = await login(request, { email: emailDriver, password: CLAVE });
    const me = await request.get('delivery/drivers/me', { headers: authHeader(driverToken) });
    expect(me.ok(), await me.text()).toBeTruthy();

    await prisma.user.deleteMany({ where: { email: emailDriver.toLowerCase() } }).catch(() => {});
  });

  // -------------------------------------------------- DELIVERY directo: no

  test('POST /orders con type DELIVERY se rechaza (nace de requestDelivery)', async ({ request }) => {
    const res = await request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'DELIVERY', items: [{ menuItemId, quantity: 1 }] },
    });
    expect(res.status()).toBe(400);
  });
});
