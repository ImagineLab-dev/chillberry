import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Enforcement de suscripción (decisión de producto 22/07/2026): al vencer la
 * prueba o cumplirse la cancelación, el tenant queda en SOLO LECTURA — las
 * escrituras devuelven 402, las lecturas siguen, el camino de pago queda
 * abierto, y la puerta pública (QR) se cierra con mensaje neutro.
 *
 * El test manipula la suscripción del tenant demo DIRECTO en la base y la
 * RESTAURA al final (afterAll + test de restauración): si este spec muere a la
 * mitad, correrlo de nuevo la restaura igual.
 */
const prisma = new PrismaClient();

let tenantId: string;
let original: {
  status: string;
  trialEndsAt: Date | null;
  cancelledAt: Date | null;
  renewalDate: Date | null;
  pendingPlanId: string | null;
  providerSubscriptionId: string | null;
} | null = null;

async function restaurar() {
  if (!original || !tenantId) return;
  await prisma.subscription.update({
    where: { tenantId },
    data: { ...original, status: original.status as never },
  });
}

test.afterAll(async () => {
  await restaurar().catch(() => {});
  await prisma.$disconnect();
});

test.describe.serial('suscripción vencida = solo lectura', () => {
  let token: string;
  let branchId: string;
  let menuItemId: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    const branch = await getFirstBranch(request, token);
    branchId = branch.id;
    const item = await getFirstMenuItem(request, token, branchId);
    menuItemId = item.id;

    const owner = await prisma.user.findUnique({
      where: { email: OWNER_CREDENTIALS.email },
      select: { tenantId: true },
    });
    tenantId = owner!.tenantId;
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    original = {
      status: sub!.status,
      trialEndsAt: sub!.trialEndsAt,
      cancelledAt: sub!.cancelledAt,
      renewalDate: sub!.renewalDate,
      pendingPlanId: sub!.pendingPlanId,
      providerSubscriptionId: sub!.providerSubscriptionId,
    };
  });

  const escribir = (request: import('@playwright/test').APIRequestContext) =>
    request.post('orders', {
      headers: authHeader(token),
      data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId, quantity: 1 }] },
    });

  test('TRIAL vencido: escrituras 402, lecturas 200, estado avisa', async ({ request }) => {
    await prisma.subscription.update({
      where: { tenantId },
      data: { status: 'TRIAL', trialEndsAt: new Date(Date.now() - 60_000), cancelledAt: null },
    });

    // Escritura del staff: bloqueada con el código que el front reconoce.
    const write = await escribir(request);
    expect(write.status()).toBe(402);
    expect(await write.text()).toContain('SUBSCRIPTION_EXPIRED');

    // Lecturas: intactas — el dueño ve todo lo que recupera pagando.
    expect((await request.get('orders', { headers: authHeader(token), params: { branchId } })).ok()).toBeTruthy();
    expect(
      (await request.get('pos/orders/pending', { headers: authHeader(token), params: { branchId } })).ok(),
    ).toBeTruthy();

    // El endpoint del banner (cualquier rol) lo dice claro.
    const estado = (await (await request.get('billing/estado', { headers: authHeader(token) })).json()) as {
      bloqueada: boolean;
      motivo: string;
    };
    expect(estado.bloqueada).toBe(true);
    expect(estado.motivo).toBe('TRIAL_VENCIDO');
  });

  test('la puerta PÚBLICA (QR) también se cierra, con mensaje neutro', async ({ request }) => {
    const mesa = await prisma.table.findFirst({
      where: { tenantId, branchId, active: true },
      select: { qrToken: true },
    });
    test.skip(!mesa, 'no hay mesa con QR en la demo');

    const res = await request.post(`public/menu/${mesa!.qrToken}/order`, {
      data: { items: [{ menuItemId, quantity: 1 }], turnstileToken: 'e2e-test-token' },
    });
    expect(res.status()).toBe(400);
    const body = await res.text();
    // Mensaje NEUTRO: el cliente final no se entera del problema comercial.
    expect(body).toContain('no está recibiendo pedidos');
    expect(body).not.toContain('suscripción');
    expect(body).not.toContain('prueba');
  });

  test('el camino de PAGO queda abierto (billing exento del bloqueo)', async ({ request }) => {
    // Cancelar/reactivar son escrituras de billing — tienen que pasar aunque
    // todo lo demás esté bloqueado: son la salida.
    const cancel = await request.post('billing/cancel', { headers: authHeader(token) });
    expect(cancel.ok(), await cancel.text()).toBeTruthy();
    const react = await request.post('billing/reactivate', { headers: authHeader(token) });
    expect(react.ok(), await react.text()).toBeTruthy();
  });

  test('cancelación cumplida: bloqueada con motivo CANCELADA', async ({ request }) => {
    await prisma.subscription.update({
      where: { tenantId },
      data: {
        status: 'ACTIVE',
        cancelledAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        renewalDate: new Date(Date.now() - 60_000),
      },
    });
    const write = await escribir(request);
    expect(write.status()).toBe(402);
    const estado = (await (await request.get('billing/estado', { headers: authHeader(token) })).json()) as {
      motivo: string;
    };
    expect(estado.motivo).toBe('CANCELADA');
  });

  test('restaurada la suscripción, las escrituras vuelven al instante (sin cache)', async ({ request }) => {
    await restaurar();
    const write = await escribir(request);
    expect(write.ok(), await write.text()).toBeTruthy();
  });
});
