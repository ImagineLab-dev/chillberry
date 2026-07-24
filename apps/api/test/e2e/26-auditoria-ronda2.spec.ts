import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Regresión de los ALTOS de la auditoría del 22/07/2026 (ronda 2).
 *
 * Igual que el spec 06: cada test corresponde a un bug REAL. Si alguno se pone
 * rojo, el bug volvió — no aflojes el test, arreglá el código.
 *
 * NO cubierto acá (comparte el mismo guard que A2, se confía por forma):
 * el canje de puntos sobre pedido con split pagado (loyalty.redeem) — armar la
 * cuenta de fidelidad con saldo es demasiado setup para duplicar un guard
 * idéntico al testeado.
 */
const prisma = new PrismaClient();
const stamp = Date.now().toString().slice(-9);
const emailInvitado = `e2e-r2-invite-${stamp}@chillberry-demo.test`;
const CLAVE_OWNER_FIJA = 'ClaveDelOwner123!';

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: emailInvitado.toLowerCase() } }).catch(() => {});
  await prisma.$disconnect();
});

test.describe.serial('auditoría ronda 2 — plata y cuentas', () => {
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

  async function createOrder(request: import('@playwright/test').APIRequestContext, quantity = 4) {
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

  // ------------------------------------------------------------------- A1
  test('A1: fijarle contraseña a un invitado ANULA el link de invitación', async ({ request }) => {
    // Alta por invitación (sin password) → queda con token.
    const crear = await request.post('users', {
      headers: authHeader(token),
      data: { name: 'E2E R2 Invitado', email: emailInvitado, role: 'WAITER' },
    });
    expect(crear.ok(), await crear.text()).toBeTruthy();
    const creado = (await crear.json()) as { id: string; invitePending: boolean };
    expect(creado.invitePending).toBe(true);

    const antes = await prisma.user.findUnique({
      where: { email: emailInvitado.toLowerCase() },
      select: { invitationToken: true },
    });
    const tokenViejo = antes!.invitationToken!;
    expect(tokenViejo).toMatch(/^[a-f0-9]{48}$/);

    // El owner le fija la clave a mano desde Editar.
    const patch = await request.patch(`users/${creado.id}`, {
      headers: authHeader(token),
      data: { password: CLAVE_OWNER_FIJA },
    });
    expect(patch.ok(), await patch.text()).toBeTruthy();

    // EL BUG: el token seguía vivo para siempre — quien tuviera el mail viejo
    // podía pisar la clave recién puesta y quedarse con la cuenta.
    const despues = await prisma.user.findUnique({
      where: { email: emailInvitado.toLowerCase() },
      select: { invitationToken: true },
    });
    expect(despues!.invitationToken).toBeNull();

    const intentoViejo = await request.post('auth/accept-invite', {
      data: { token: tokenViejo, password: 'ClaveDelAtacante123!' },
    });
    expect(intentoViejo.status()).toBe(401);

    // Y la clave que puso el owner sigue funcionando.
    const loginOk = await request.post('auth/login', {
      data: { email: emailInvitado, password: CLAVE_OWNER_FIJA, turnstileToken: 'e2e-test-token' },
    });
    expect(loginOk.ok(), await loginOk.text()).toBeTruthy();
  });

  // ------------------------------------------------------------------- A2
  test('A2: descuento sobre pedido con split ya cobrado → rechazado', async ({ request }) => {
    const order = await createOrder(request);
    await ensureOpenSession(request);

    const half = Math.round((Number(order.total) / 2) * 100) / 100;
    const other = Math.round((Number(order.total) - half) * 100) / 100;
    const split = await request.post(`waiter/orders/${order.id}/split`, {
      headers: authHeader(token),
      data: { mode: 'BY_PERSON', parts: [{ label: 'Ana', amount: half }, { label: 'Beto', amount: other }] },
    });
    expect(split.ok(), await split.text()).toBeTruthy();
    const parts = (await split.json()) as { id: string; amount: string }[];

    // Ana paga su parte.
    const paid = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: {
        idempotencyKey: randomUUID(),
        billSplitId: parts[0]!.id,
        payments: [{ method: 'CASH', amount: Number(parts[0]!.amount) }],
      },
    });
    expect(paid.ok(), await paid.text()).toBeTruthy();

    // EL BUG: el descuento bajaba `total` pero los splits impagos conservaban
    // su monto — la mesa pagaba completo igual y el descuento se esfumaba.
    const desc = await request.post('pos/discounts', {
      headers: authHeader(token),
      data: { orderId: order.id, type: 'PERCENTAGE', value: 20, reason: 'Cortesía imposible' },
    });
    expect(desc.status()).toBe(409);

    // El total no se movió.
    const after = await request.get(`orders/${order.id}`, { headers: authHeader(token) });
    expect(Number((await after.json()).total)).toBe(Number(order.total));
  });

  // ------------------------------------------------------------------- A3
  test('A3: dos cobros MIXTOS concurrentes no duplican el efectivo', async ({ request }) => {
    const order = await createOrder(request);
    await ensureOpenSession(request);

    const total = Number(order.total);
    const cash = Math.round(total * 0.6 * 100) / 100;
    const card = Math.round((total - cash) * 100) / 100;
    const mixto = () =>
      request.post(`pos/orders/${order.id}/charge`, {
        headers: authHeader(token),
        data: {
          idempotencyKey: randomUUID(), // claves DISTINTAS = dos terminales
          payments: [
            { method: 'CASH', amount: cash },
            { method: 'CARD', amount: card, provider: 'MOCK' },
          ],
        },
      });

    // EL BUG: la transacción con revalidación cubría solo el cobro
    // todo-efectivo; el mixto creaba sus líneas cash sueltas — dos terminales
    // anotaban el efectivo DOS veces por un solo consumo.
    const [r1, r2] = await Promise.all([mixto(), mixto()]);
    const okCount = [r1, r2].filter((r) => r.ok()).length;
    expect(okCount).toBe(1);
    // El perdedor recibe un conflicto (409 carrera) o un 400 (el saldo ya cambió).
    const perdedor = r1.ok() ? r2 : r1;
    expect([400, 409]).toContain(perdedor.status());

    // En la base hay UNA sola línea de efectivo aprobada, no dos.
    const cashLines = await prisma.payment.findMany({
      where: { orderId: order.id, method: 'CASH', status: 'APPROVED' },
    });
    expect(cashLines).toHaveLength(1);
    expect(Number(cashLines[0]!.amount)).toBeCloseTo(cash, 1);
  });

  // ------------------------------------------------------------------- M2
  test('M2: marcar COMPLETED a mano un pedido SIN pagar → rechazado', async ({ request }) => {
    const order = await createOrder(request, 1);

    // Se lo lleva hasta READY por el flujo normal de estados.
    for (const status of ['ACCEPTED', 'PREPARING', 'READY']) {
      const r = await request.patch(`orders/${order.id}/status`, {
        headers: authHeader(token),
        data: { status },
      });
      expect(r.ok(), `${status}: ${await r.text()}`).toBeTruthy();
    }

    // EL BUG: COMPLETED manual cerraba el pedido sin pago, sin factura, sin
    // stock, con la mesa colgada — y figuraba como venta en los reportes.
    const res = await request.patch(`orders/${order.id}/status`, {
      headers: authHeader(token),
      data: { status: 'COMPLETED' },
    });
    expect(res.status()).toBe(409);

    // Cobrándolo, se completa solo (el camino legítimo sigue andando).
    await ensureOpenSession(request);
    const charge = await request.post(`pos/orders/${order.id}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(order.total) }] },
    });
    expect(charge.ok(), await charge.text()).toBeTruthy();
    expect(((await charge.json()) as { order: { status: string } }).order.status).toBe('COMPLETED');
  });

  // ------------------------------------------------------------------- M3
  test('M3: cobrar un pedido NO libera la mesa si tiene otro abierto', async ({ request }) => {
    // Mesa PROPIA del test: las mesas de la demo acumulan pedidos activos de
    // corridas anteriores (la mesa "1" tenía 69), y con cualquier pedido ajeno
    // abierto el guard —correctamente— no libera nunca. Una mesa recién creada
    // garantiza que los únicos pedidos activos son los de este test.
    const crearMesa = await request.post('tables', {
      headers: authHeader(token),
      data: { branchId, code: `R2-${stamp}` },
    });
    expect(crearMesa.ok(), await crearMesa.text()).toBeTruthy();
    const mesa = (await crearMesa.json()) as { id: string; status: string };

    const crear = (extra: object = {}) =>
      request.post('orders', {
        headers: authHeader(token),
        data: { branchId, tableId: mesa.id, items: [{ menuItemId, quantity: 1 }], ...extra },
      });
    const o1 = (await (await crear()).json()) as { id: string; total: string };
    const o2 = (await (await crear()).json()) as { id: string; total: string };

    // La mesa se marca OCCUPIED explícitamente (crear pedido no lo hace solo;
    // en el flujo real lo hace el mozo al abrirla).
    const abrir = await request.post(`waiter/tables/${mesa.id}/open`, { headers: authHeader(token) });
    expect(abrir.ok(), await abrir.text()).toBeTruthy();

    await ensureOpenSession(request);
    const charge = await request.post(`pos/orders/${o1.id}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(o1.total) }] },
    });
    expect(charge.ok(), await charge.text()).toBeTruthy();

    // EL BUG: la mesa quedaba AVAILABLE con la cuenta de o2 todavía abierta —
    // el salón la pintaba libre y se sentaba gente encima.
    const after1 = await request.get(`tables/${mesa.id}`, { headers: authHeader(token) });
    expect(((await after1.json()) as { status: string }).status).not.toBe('AVAILABLE');

    // Al cobrar el SEGUNDO, ahora sí se libera.
    const charge2 = await request.post(`pos/orders/${o2.id}/charge`, {
      headers: authHeader(token),
      data: { idempotencyKey: randomUUID(), payments: [{ method: 'CASH', amount: Number(o2.total) }] },
    });
    expect(charge2.ok(), await charge2.text()).toBeTruthy();
    const after2 = await request.get(`tables/${mesa.id}`, { headers: authHeader(token) });
    expect(((await after2.json()) as { status: string }).status).toBe('AVAILABLE');

    // La mesa del test se desactiva (tiene historial de pedidos, no se puede
    // borrar) para no ensuciar el mapa del salon de la demo.
    await request.patch(`tables/${mesa.id}`, { headers: authHeader(token), data: { active: false } });
  });

  // ------------------------------------------------------------------- M1
  test('M1: un mozo atado a una sucursal no puede tocar un pedido de otra por id', async ({ request }) => {
    const branchesRes = await request.get('branches', { headers: authHeader(token) });
    const branches = (await branchesRes.json()) as Array<{ id: string }>;
    test.skip(branches.length < 2, 'se necesitan 2 sucursales');
    const otra = branches.find((b) => b.id !== branchId)!;

    // Mozo atado a OTRA sucursal (distinta de la del pedido).
    const emailMozo = `e2e-r2-scope-${stamp}@chillberry-demo.test`;
    const alta = await request.post('users', {
      headers: authHeader(token),
      data: { name: 'E2E R2 Scope', email: emailMozo, password: CLAVE_OWNER_FIJA, role: 'WAITER', branchId: otra.id },
    });
    expect(alta.ok(), await alta.text()).toBeTruthy();
    const mozoToken = await login(request, { email: emailMozo, password: CLAVE_OWNER_FIJA });

    // Pedido en la sucursal principal (la del owner/demo).
    const order = await createOrder(request, 1);

    // EL BUG: con el UUID alcanzaba — GET y mutaciones por id no validaban
    // sucursal (create sí). Ahora: 403 en las tres operaciones.
    const ver = await request.get(`orders/${order.id}`, { headers: authHeader(mozoToken) });
    expect(ver.status()).toBe(403);
    const agregar = await request.post(`orders/${order.id}/items`, {
      headers: authHeader(mozoToken),
      data: { items: [{ menuItemId, quantity: 1 }] },
    });
    expect(agregar.status()).toBe(403);
    const cuenta = await request.post(`waiter/orders/${order.id}/request-bill`, {
      headers: authHeader(mozoToken),
    });
    expect(cuenta.status()).toBe(403);

    // Limpieza: el mozo de prueba no operó nada — borrado duro pasa.
    await prisma.user.deleteMany({ where: { email: emailMozo.toLowerCase() } }).catch(() => {});
  });
});
