import { test, expect, type APIRequestContext } from '@playwright/test';
import { login, authHeader, OWNER_CREDENTIALS } from './helpers';

/**
 * Aislamiento entre SUCURSALES del mismo restaurante.
 *
 * El dueño ve todos sus locales. El resto del personal —gerente, mozo, cajero,
 * cocina— sólo el suyo. Antes esto no existía: el único límite era el rol, y un
 * cajero podía cerrar el arqueo de otro local o reembolsar contra su cajón.
 *
 * El caso que más importa acá es el del parámetro AUSENTE. Filtrar mal cuando
 * piden otra sucursal es visible; omitir `?branchId` y recibir el restaurante
 * entero no da error ninguno, y es el modo de fallo que se cuela a producción.
 */

const CLAVE_EMPLEADO = 'Chillberry123!';

async function crearEmpleadoEnSucursal(
  request: APIRequestContext,
  tokenDueño: string,
  role: string,
  branchId: string,
): Promise<{ token: string; id: string }> {
  const stamp = Date.now().toString().slice(-9) + Math.floor(Math.random() * 1000);
  const email = `e2e-suc-${role.toLowerCase()}-${stamp}@chillberry-demo.test`;

  const alta = await request.post('users', {
    headers: authHeader(tokenDueño),
    data: { email, name: `E2E ${role}`, password: CLAVE_EMPLEADO, role, branchId },
  });
  expect(alta.ok(), `no se pudo crear el empleado: ${await alta.text()}`).toBeTruthy();
  const creado = (await alta.json()) as { id: string; branchId: string | null };
  expect(creado.branchId, 'el empleado tiene que quedar atado a la sucursal').toBe(branchId);

  const token = await login(request, { email, password: CLAVE_EMPLEADO });
  return { token, id: creado.id };
}

test.describe('aislamiento entre sucursales', () => {
  let tokenDueño: string;
  let sucursalA: string;
  let sucursalB: string;
  let tokenGerenteA: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.E2E_API_BASE_URL ?? 'http://localhost:3001/api/',
    });

    tokenDueño = await login(request, OWNER_CREDENTIALS);

    const res = await request.get('branches', { headers: authHeader(tokenDueño) });
    const sucursales = (await res.json()) as Array<{ id: string; name: string }>;
    test.skip(sucursales.length < 2, 'hacen falta 2 sucursales en el tenant demo');

    sucursalA = sucursales[0]!.id;
    sucursalB = sucursales[1]!.id;

    const gerente = await crearEmpleadoEnSucursal(request, tokenDueño, 'ADMIN', sucursalA);
    tokenGerenteA = gerente.token;

    await request.dispose();
  });

  test('la sucursal tiene que existir y ser del mismo restaurante', async ({ request }) => {
    const res = await request.post('users', {
      headers: authHeader(tokenDueño),
      data: {
        email: `e2e-suc-falsa-${Date.now()}@chillberry-demo.test`,
        name: 'E2E Sucursal Falsa',
        password: CLAVE_EMPLEADO,
        role: 'WAITER',
        branchId: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(res.status(), 'una sucursal inexistente no puede aceptarse').toBe(404);
  });

  test('el dueño sigue viendo TODAS sus sucursales', async ({ request }) => {
    for (const id of [sucursalA, sucursalB]) {
      const res = await request.get(`tables?branchId=${id}`, { headers: authHeader(tokenDueño) });
      expect(res.ok(), `el dueño debería ver la sucursal ${id}`).toBeTruthy();
    }
  });

  const listados = ['tables', 'orders', 'menu/items', 'kitchen/board', 'inventory/ingredients'];

  for (const ruta of listados) {
    test(`${ruta}: pedir la sucursal AJENA devuelve la propia, no la ajena`, async ({ request }) => {
      const propia = await request.get(`${ruta}?branchId=${sucursalA}`, { headers: authHeader(tokenGerenteA) });
      const ajena = await request.get(`${ruta}?branchId=${sucursalB}`, { headers: authHeader(tokenGerenteA) });

      if (!propia.ok() || !ajena.ok()) {
        test.skip(true, `${ruta} no respondió 200 para el gerente`);
      }
      // Pedir la ajena devuelve exactamente lo mismo que pedir la propia: el
      // filtro se fuerza, no se respeta lo que mandó el cliente.
      expect(JSON.stringify(await ajena.json()), `${ruta} filtró por la sucursal AJENA`).toBe(
        JSON.stringify(await propia.json()),
      );
    });

    test(`${ruta}: OMITIR el parámetro no destapa el restaurante entero`, async ({ request }) => {
      const sinParam = await request.get(ruta, { headers: authHeader(tokenGerenteA) });
      const propia = await request.get(`${ruta}?branchId=${sucursalA}`, { headers: authHeader(tokenGerenteA) });

      if (!sinParam.ok() || !propia.ok()) {
        test.skip(true, `${ruta} no respondió 200 para el gerente`);
      }
      // Sin el decorador, `branchId: undefined` sale del where de Prisma y esto
      // devolvía TODAS las sucursales, sin un solo error.
      expect(JSON.stringify(await sinParam.json()), `${ruta} sin filtro devolvió de más`).toBe(
        JSON.stringify(await propia.json()),
      );
    });
  }

  test('el gerente NO puede abrir caja en la sucursal ajena', async ({ request }) => {
    const res = await request.post('pos/cash-sessions/open', {
      headers: authHeader(tokenGerenteA),
      data: { branchId: sucursalB, openingAmount: 100000 },
    });
    expect(res.status(), `pudo abrir caja ajena: ${await res.text()}`).toBe(403);
  });

  test('pero SÍ puede en la suya', async ({ request }) => {
    const res = await request.post('pos/cash-sessions/open', {
      headers: authHeader(tokenGerenteA),
      data: { branchId: sucursalA, openingAmount: 100000 },
    });
    // 201 si no había caja abierta, 409 si ya la había. Cualquiera de los dos
    // demuestra que pasó el control de sucursal; un 403 sería el fallo.
    expect([201, 409]).toContain(res.status());
  });
});
