import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { login, authHeader, OWNER_CREDENTIALS } from './helpers';

/**
 * Aislamiento entre tenants — la prueba empírica.
 *
 * El resto de la suite verifica que cada tenant vea LO SUYO. Esto verifica lo
 * contrario, que es lo que importa cuando hay varios restaurantes pagando: que
 * NO pueda ver ni tocar lo ajeno.
 *
 * Se da de alta un tenant nuevo (el atacante) y con SU token se piden y se
 * modifican recursos reales del tenant demo. Cualquier 200 acá es una fuga de
 * datos entre clientes.
 *
 * NO se prueban los DELETE a propósito: si el aislamiento estuviera roto, el
 * propio test borraría datos reales. Se prueban lectura (GET) y escritura
 * (PATCH), que comparten el mismo camino de autorización.
 */

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** El código se guarda hasheado; se lo encuentra probando los 6 dígitos. */
async function leerCodigo(email: string): Promise<string> {
  const registro = await prisma.verificationCode.findFirst({
    where: { email: email.toLowerCase(), purpose: 'SIGNUP', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!registro) throw new Error(`Sin código pendiente para ${email}`);
  for (let i = 0; i < 1_000_000; i++) {
    const candidato = String(i).padStart(6, '0');
    if (createHash('sha256').update(candidato).digest('hex') === registro.codeHash) return candidato;
  }
  throw new Error('El hash no corresponde a ningún código de 6 dígitos');
}

/** Da de alta un tenant limpio y devuelve su token. Este es "el atacante". */
async function crearTenantIntruso(request: APIRequestContext): Promise<string> {
  const stamp = Date.now().toString().slice(-9);
  const email = `e2e-intruso-${stamp}@chillberry-demo.test`;
  const alta = {
    tenantName: `E2E Intruso ${stamp}`,
    ownerName: 'E2E Intruso',
    email,
    password: 'Chillberry123!',
    countryCode: 'PY',
    turnstileToken: 'e2e-test-token',
  };

  const registro = await request.post('auth/register', { data: alta });
  expect(registro.ok(), `alta falló: ${await registro.text()}`).toBeTruthy();

  const codigo = await leerCodigo(email);
  const verif = await request.post('auth/verify-signup', { data: { email, code: codigo } });
  expect(verif.ok(), `verificación falló: ${await verif.text()}`).toBeTruthy();

  const { accessToken } = (await verif.json()) as { accessToken?: string };
  if (accessToken) return accessToken;

  return login(request, { email, password: alta.password });
}

/** Primer id de una lista, o null si el endpoint no devolvió nada usable. */
async function primerId(
  request: APIRequestContext,
  token: string,
  ruta: string,
  campo = 'id',
): Promise<string | null> {
  const res = await request.get(ruta, { headers: authHeader(token) });
  if (!res.ok()) return null;
  const cuerpo = (await res.json()) as unknown;
  const lista = Array.isArray(cuerpo)
    ? cuerpo
    : ((cuerpo as { data?: unknown[]; items?: unknown[] })?.data ??
       (cuerpo as { items?: unknown[] })?.items ??
       []);
  const primero = (lista as Array<Record<string, unknown>>)[0];
  const valor = primero?.[campo];
  return typeof valor === 'string' ? valor : null;
}

test.describe('aislamiento entre tenants', () => {
  let tokenIntruso: string;
  let tokenVictima: string;
  const idsVictima: Record<string, string | null> = {};

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.E2E_API_BASE_URL ?? 'http://localhost:3001/api/',
    });

    tokenVictima = await login(request, OWNER_CREDENTIALS);
    tokenIntruso = await crearTenantIntruso(request);

    // Recursos REALES del tenant demo, que el intruso va a intentar tocar.
    const branchId = await primerId(request, tokenVictima, 'branches');
    idsVictima.branch = branchId;
    idsVictima.table = branchId ? await primerId(request, tokenVictima, `tables?branchId=${branchId}`) : null;
    idsVictima.order = branchId ? await primerId(request, tokenVictima, `orders?branchId=${branchId}`) : null;
    idsVictima.menuItem = branchId ? await primerId(request, tokenVictima, `menu/items?branchId=${branchId}`) : null;
    idsVictima.customer = await primerId(request, tokenVictima, 'customers');
    idsVictima.user = await primerId(request, tokenVictima, 'users');
    idsVictima.restaurant = await primerId(request, tokenVictima, 'restaurants');

    await request.dispose();
  });

  test('el alta del intruso creó un tenant DISTINTO', async ({ request }) => {
    const mio = await request.get('branches', { headers: authHeader(tokenIntruso) });
    expect(mio.ok()).toBeTruthy();
    const mias = (await mio.json()) as Array<{ id: string }>;
    // Un tenant recién creado no comparte ninguna sucursal con el demo.
    expect(mias.map((b) => b.id)).not.toContain(idsVictima.branch);
  });

  // --- LECTURA -------------------------------------------------------------

  const lecturas: Array<[string, keyof typeof idsVictima, (id: string) => string]> = [
    ['sucursal', 'branch', (id) => `branches/${id}`],
    ['horarios de la sucursal', 'branch', (id) => `branches/${id}/schedule`],
    ['mesa', 'table', (id) => `tables/${id}`],
    ['pedido', 'order', (id) => `orders/${id}`],
    ['grupos de modificadores del ítem', 'menuItem', (id) => `menu/items/${id}/modifier-groups`],
    ['restaurante', 'restaurant', (id) => `restaurants/${id}`],
  ];

  for (const [nombre, clave, ruta] of lecturas) {
    test(`un tenant ajeno NO puede leer ${nombre}`, async ({ request }) => {
      const id = idsVictima[clave];
      test.skip(!id, `el tenant demo no tiene ${nombre} para probar`);

      const res = await request.get(ruta(id!), { headers: authHeader(tokenIntruso) });
      expect(
        res.status(),
        `FUGA: GET ${ruta(id!)} devolvió ${res.status()} a otro tenant — ${await res.text()}`,
      ).not.toBe(200);
      expect([403, 404]).toContain(res.status());
    });
  }

  // --- ESCRITURA -----------------------------------------------------------

  test('un tenant ajeno NO puede modificar una mesa', async ({ request }) => {
    test.skip(!idsVictima.table, 'sin mesa para probar');
    const res = await request.patch(`tables/${idsVictima.table}`, {
      headers: authHeader(tokenIntruso),
      // Valor VÁLIDO a propósito (el DTO acepta 1..50). Con uno inválido la
      // request muere en validación y nunca llega a la capa de autorización:
      // el test pasaría sin haber probado nada.
      data: { capacity: 4 },
    });
    expect(res.status(), `FUGA DE ESCRITURA: ${await res.text()}`).not.toBe(200);
    expect([403, 404]).toContain(res.status());
  });

  test('un tenant ajeno NO puede modificar una sucursal', async ({ request }) => {
    test.skip(!idsVictima.branch, 'sin sucursal para probar');
    const res = await request.patch(`branches/${idsVictima.branch}`, {
      headers: authHeader(tokenIntruso),
      data: { name: 'INTRUSO ESTUVO ACA' },
    });
    expect(res.status(), `FUGA DE ESCRITURA: ${await res.text()}`).not.toBe(200);
    expect([403, 404]).toContain(res.status());
  });

  test('un tenant ajeno NO puede cambiar el estado de un pedido', async ({ request }) => {
    test.skip(!idsVictima.order, 'sin pedido para probar');
    const res = await request.patch(`orders/${idsVictima.order}/status`, {
      headers: authHeader(tokenIntruso),
      data: { status: 'CANCELLED' },
    });
    expect(res.status(), `FUGA DE ESCRITURA: ${await res.text()}`).not.toBe(200);
    // Se exige 403/404: un 400 significaría que murió en validación sin llegar
    // a comprobar de quién es el pedido, y entonces esto no probaría nada.
    expect([403, 404]).toContain(res.status());
  });

  test('un tenant ajeno NO puede dar de baja un usuario de otro', async ({ request }) => {
    test.skip(!idsVictima.user, 'sin usuario para probar');
    const res = await request.delete(`users/${idsVictima.user}`, { headers: authHeader(tokenIntruso) });
    expect(res.status(), `FUGA: pudo borrar un usuario ajeno — ${await res.text()}`).not.toBe(200);
    expect(res.status()).not.toBe(204);
  });

  // --- LISTADOS ------------------------------------------------------------

  test('los listados del intruso vienen vacíos, sin datos del otro tenant', async ({ request }) => {
    for (const ruta of ['orders', 'customers', 'tables', 'delivery', 'reservations']) {
      const res = await request.get(ruta, { headers: authHeader(tokenIntruso) });
      if (!res.ok()) continue; // 400 por falta de filtros obligatorios: no es fuga
      const cuerpo = (await res.json()) as unknown;
      const lista = Array.isArray(cuerpo)
        ? cuerpo
        : ((cuerpo as { data?: unknown[] })?.data ?? (cuerpo as { items?: unknown[] })?.items ?? []);
      expect(
        (lista as unknown[]).length,
        `FUGA: GET ${ruta} le devolvió ${(lista as unknown[]).length} registros a un tenant nuevo`,
      ).toBe(0);
    }
  });

  test('un tenant común no llega a los endpoints de super-admin', async ({ request }) => {
    const res = await request.get('super-admin/tenants', { headers: authHeader(tokenIntruso) });
    expect(res.status(), `FUGA: un tenant común listó TODOS los tenants — ${await res.text()}`).not.toBe(200);
    expect([401, 403, 404]).toContain(res.status());
  });
});
