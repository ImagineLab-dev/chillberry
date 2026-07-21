import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { login, authHeader } from './helpers';

/**
 * Cobro mensual de la suscripción del SaaS.
 *
 * Lo que motiva este archivo: NO había ninguna prueba de billing, y por eso
 * nadie vio dos agujeros que sólo se manifiestan con plata real de por medio.
 *
 *  1. La renovación no generaba factura nueva. El webhook buscaba la factura
 *     por el id de la suscripción, y hay UNA sola por suscripción: del segundo
 *     mes en adelante reescribía esa misma y dejaba `renewalDate` en el
 *     vencimiento original, o sea en el pasado. Sin historial de lo cobrado.
 *  2. Un upgrade se aplicaba en el acto sin cobrar. El dueño tomaba el plan más
 *     caro y se lo asignaba gratis, salteándose los límites de sucursales y
 *     usuarios, que son la única barrera de pago.
 *
 * Corre contra el proveedor simulado, que es el mismo camino de código que el
 * real: cambia el adapter, no la lógica.
 */

const prisma = new PrismaClient();
const SECRETO = process.env.DLOCAL_WEBHOOK_SECRET ?? 'dev-dlocal-webhook-secret-change-me';

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Manda un webhook firmado como lo haría el proveedor. */
async function webhook(
  request: APIRequestContext,
  tipo: 'SUBSCRIPTION_APPROVED' | 'SUBSCRIPTION_FAILED',
  providerSubscriptionId: string,
) {
  const body = { eventId: randomUUID(), eventType: tipo, providerSubscriptionId };
  const crudo = Buffer.from(JSON.stringify(body));
  return request.post('webhooks/dlocal', {
    headers: { 'Content-Type': 'application/json', 'X-Signature': createHmac('sha256', SECRETO).update(crudo).digest('hex') },
    data: body,
  });
}

/** Crea un restaurante nuevo y devuelve su token: cada test necesita el suyo. */
async function nuevoTenant(request: APIRequestContext): Promise<{ token: string; tenantId: string }> {
  const stamp = Date.now().toString().slice(-9) + Math.floor(Math.random() * 1000);
  const email = `e2e-sub-${stamp}@chillberry-demo.test`;
  await request.post('auth/register', {
    data: {
      tenantName: `E2E Sub ${stamp}`,
      ownerName: 'E2E',
      email,
      password: 'Chillberry123!',
      countryCode: 'PY',
      turnstileToken: 'e2e-test-token',
    },
  });
  const reg = await prisma.verificationCode.findFirst({
    where: { email, purpose: 'SIGNUP', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  let codigo = '';
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, '0');
    if (createHash('sha256').update(c).digest('hex') === reg!.codeHash) {
      codigo = c;
      break;
    }
  }
  const res = await request.post('auth/verify-signup', { data: { email, code: codigo } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const token = await login(request, { email, password: 'Chillberry123!' });
  const user = await prisma.user.findUnique({ where: { email } });
  return { token, tenantId: user!.tenantId };
}

test.describe.serial('suscripción mensual', () => {
  let token: string;
  let tenantId: string;
  let planStarter: string;
  let planCaro: string;
  let providerSubId: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.E2E_API_BASE_URL ?? 'http://localhost:3001/api/',
    });
    ({ token, tenantId } = await nuevoTenant(request));
    const planes = (await (await request.get('billing/plans', { headers: authHeader(token) })).json()) as Array<{
      id: string;
      code: string;
    }>;
    planStarter = planes.find((p) => p.code === 'STARTER')!.id;
    planCaro = planes.find((p) => p.code === 'ENTERPRISE')!.id;
    await request.dispose();
  });

  test('contratar deja el cobro PENDIENTE, no activo', async ({ request }) => {
    const res = await request.post('billing/subscribe', {
      headers: authHeader(token),
      data: { planId: planStarter },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { providerSubscriptionId } = (await res.json()) as { providerSubscriptionId: string };
    providerSubId = providerSubscriptionId;

    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    // El id del proveedor tiene que quedar en la SUSCRIPCIÓN: es contra lo que
    // se correlaciona cada cobro mensual.
    expect(sub!.providerSubscriptionId).toBe(providerSubId);
    expect(sub!.status, 'no se activa hasta que el cobro se aprueba').not.toBe('ACTIVE');

    const facturas = await prisma.subscriptionInvoice.findMany({ where: { subscriptionId: sub!.id } });
    expect(facturas).toHaveLength(1);
    expect(facturas[0]!.status).toBe('PENDING');
  });

  test('el primer cobro aprobado activa la suscripción', async ({ request }) => {
    expect((await webhook(request, 'SUBSCRIPTION_APPROVED', providerSubId)).ok()).toBeTruthy();

    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    expect(sub!.status).toBe('ACTIVE');

    const facturas = await prisma.subscriptionInvoice.findMany({ where: { subscriptionId: sub!.id } });
    expect(facturas, 'el primer cobro paga la factura existente, no crea otra').toHaveLength(1);
    expect(facturas[0]!.status).toBe('PAID');
    expect(sub!.renewalDate!.getTime()).toBe(facturas[0]!.periodEnd.getTime());
  });

  test('EL SEGUNDO MES genera su propia factura y corre la renovación', async ({ request }) => {
    const antes = await prisma.subscription.findUnique({ where: { tenantId } });

    expect((await webhook(request, 'SUBSCRIPTION_APPROVED', providerSubId)).ok()).toBeTruthy();

    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    const facturas = await prisma.subscriptionInvoice.findMany({
      where: { subscriptionId: sub!.id },
      orderBy: { periodStart: 'asc' },
    });

    // Éste es el bug que se está fijando: antes seguía habiendo UNA sola.
    expect(facturas, 'cada cobro mensual tiene que dejar su propia factura').toHaveLength(2);
    expect(facturas[1]!.status).toBe('PAID');

    // El período nuevo arranca donde terminó el anterior: si el webhook llega
    // con demora, el cliente no pierde los días que ya pagó.
    expect(facturas[1]!.periodStart.getTime()).toBe(facturas[0]!.periodEnd.getTime());

    expect(
      sub!.renewalDate!.getTime(),
      'la renovación tiene que avanzar, antes quedaba fija en una fecha ya pasada',
    ).toBeGreaterThan(antes!.renewalDate!.getTime());
  });

  test('un cobro fallido deja la suscripción morosa', async ({ request }) => {
    expect((await webhook(request, 'SUBSCRIPTION_FAILED', providerSubId)).ok()).toBeTruthy();
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    expect(sub!.status).toBe('PAST_DUE');
    expect(sub!.pastDueSince).not.toBeNull();
  });

  test('un UPGRADE no se regala: manda a pagar', async ({ request }) => {
    const antes = await prisma.subscription.findUnique({ where: { tenantId } });

    const res = await request.post('billing/change-plan', {
      headers: authHeader(token),
      data: { planId: planCaro },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const cuerpo = (await res.json()) as { applied?: string; redirectUrl?: string };
    expect(cuerpo.applied, 'el upgrade tiene que quedar esperando el pago').toBe('pending_payment');

    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    expect(sub!.planId, 'el plan NO puede cambiar antes de cobrar').toBe(antes!.planId);
    expect(sub!.pendingPlanId).toBe(planCaro);
  });

  test('y recién se aplica cuando el cobro se aprueba', async ({ request }) => {
    const sub0 = await prisma.subscription.findUnique({ where: { tenantId } });
    expect((await webhook(request, 'SUBSCRIPTION_APPROVED', sub0!.providerSubscriptionId!)).ok()).toBeTruthy();

    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    expect(sub!.planId, 'ahora sí, ya cobrado').toBe(planCaro);
    expect(sub!.status).toBe('ACTIVE');
    expect(sub!.pendingPlanId).toBeNull();
  });
});
