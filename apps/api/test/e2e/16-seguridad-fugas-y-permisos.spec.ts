import { test, expect, type APIRequestContext } from '@playwright/test';
import { OWNER_CREDENTIALS, authHeader, getFirstBranch, login } from './helpers';

/**
 * Fugas de credenciales y chequeos de pertenencia.
 *
 * Cada caso de acá fue un agujero real, encontrado en la auditoría de seguridad:
 *
 *  - `GET /waiter/tables` devolvía la fila `Table` entera, con el `qrToken`. Ese
 *    token es la credencial con la que se pide y se lee la cuenta SIN
 *    autenticarse: con uno solo, cualquiera crea pedidos a nombre de una mesa.
 *  - El `confirmationCode` de una entrega viajaba al repartidor. Es el secreto
 *    que el CLIENTE le dicta al recibir: si lo lee, cierra entregas sin pasar
 *    por la puerta del cliente.
 *  - `GET /delivery/:id`, cancelar y reportar incidente no validaban que la
 *    entrega fuera suya: un repartidor podía leer los datos de todos los
 *    clientes del local y cancelarle la entrega a un compañero.
 */
test.describe('seguridad: fugas de credenciales y pertenencia', () => {
  let ownerToken: string;
  let branchId: string;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, ownerToken)).id;
  });

  test('la vista del mozo NO expone el qrToken de las mesas', async ({ request }) => {
    const res = await request.get('waiter/tables', {
      headers: authHeader(ownerToken),
      params: { branchId },
    });
    expect(res.ok()).toBeTruthy();
    // Se mira el JSON CRUDO: si el campo aparece en cualquier nivel, se filtró.
    expect(await res.text()).not.toContain('qrToken');
  });

  test('pero sigue trayendo lo que la pantalla necesita', async ({ request }) => {
    const res = await request.get('waiter/tables', {
      headers: authHeader(ownerToken),
      params: { branchId },
    });
    const tables = (await res.json()) as Record<string, unknown>[];
    expect(tables.length).toBeGreaterThan(0);
    for (const campo of ['id', 'code', 'status', 'orders']) {
      expect(tables[0]).toHaveProperty(campo);
    }
  });

  test('el admin SÍ lo ve en GET /tables (lo necesita para imprimir el QR)', async ({ request }) => {
    const res = await request.get('tables', { headers: authHeader(ownerToken), params: { branchId } });
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toContain('qrToken');
  });

  test('abrir mesa y editar mesa tampoco devuelven el token', async ({ request }) => {
    const tables = (await (
      await request.get('waiter/tables', { headers: authHeader(ownerToken), params: { branchId } })
    ).json()) as { id: string }[];
    const tableId = tables[0]!.id;

    const abrir = await request.post(`waiter/tables/${tableId}/open`, { headers: authHeader(ownerToken) });
    expect(await abrir.text()).not.toContain('qrToken');

    const editar = await request.patch(`tables/${tableId}`, {
      headers: authHeader(ownerToken),
      data: { capacity: 4 },
    });
    expect(await editar.text()).not.toContain('qrToken');
  });
});

test.describe('seguridad: la baja de una cuenta corta la sesión abierta', () => {
  test('un empleado dado de baja no puede refrescar ni volver a entrar', async ({ request }) => {
    const ownerToken = await login(request, OWNER_CREDENTIALS);
    const email = `e2e-baja-${Date.now()}@chillberry-demo.test`;

    const alta = await request.post('users', {
      headers: authHeader(ownerToken),
      data: { name: 'E2E Baja', email, password: 'Chillberry123!', role: 'CASHIER' },
    });
    expect(alta.ok()).toBeTruthy();
    const { id: userId } = (await alta.json()) as { id: string };

    const sesion = await request.post('auth/login', {
      data: { email, password: 'Chillberry123!', turnstileToken: 'e2e-test-token' },
    });
    const { refreshToken } = (await sesion.json()) as { refreshToken: string };

    // La vía documentada para echar a alguien es desactivar la cuenta. Antes
    // eso sólo cortaba el LOGIN: con la app abierta, el refresh seguía emitiendo
    // tokens nuevos con vencimiento fresco, o sea acceso indefinido.
    const baja = await request.patch(`users/${userId}`, {
      headers: authHeader(ownerToken),
      data: { active: false },
    });
    expect(baja.ok()).toBeTruthy();

    const refresco = await request.post('auth/refresh', { data: { refreshToken } });
    expect(refresco.status()).toBe(401);

    const reLogin = await request.post('auth/login', {
      data: { email, password: 'Chillberry123!', turnstileToken: 'e2e-test-token' },
    });
    expect(reLogin.status()).toBe(401);
  });
});

test.describe('seguridad: el código de entrega es un secreto del cliente', () => {
  let ownerToken: string;
  let branchId: string;
  let driverToken: string;
  let driverId: string;
  let deliveryId: string;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, ownerToken)).id;

    const stamp = Date.now().toString().slice(-6);
    const email = `e2e-driver-${stamp}@chillberry-demo.test`;
    const alta = await request.post('delivery/drivers', {
      headers: authHeader(ownerToken),
      data: {
        name: 'E2E Repartidor',
        email,
        password: 'Chillberry123!',
        phone: `+59598100${stamp}`,
        vehicleType: 'MOTORCYCLE',
      },
    });
    expect(alta.ok()).toBeTruthy();

    driverToken = await login(request, { email, password: 'Chillberry123!' });
    await request.patch('delivery/drivers/me/availability', {
      headers: authHeader(driverToken),
      data: { availability: 'ONLINE' },
    });
    driverId = ((await (
      await request.get('delivery/drivers/me', { headers: authHeader(driverToken) })
    ).json()) as { id: string }).id;

    deliveryId = await crearDeliveryAsignadoA(request, ownerToken, branchId, driverId);
  });

  test('ninguna ruta del repartidor devuelve el confirmationCode', async ({ request }) => {
    // OJO con este tipo de aserción: "no contiene X" pasa igual si la petición
    // FALLÓ (un 409 tampoco contiene el campo). Por eso cada ruta se verifica
    // exitosa ANTES de mirar el cuerpo — si no, el test se vuelve decorativo.
    const rutas = [
      () => request.get('delivery/orders/available', { headers: authHeader(driverToken) }),
      () => request.get(`delivery/${deliveryId}`, { headers: authHeader(driverToken) }),
      () => request.post(`delivery/${deliveryId}/accept`, { headers: authHeader(driverToken) }),
      () => request.post(`delivery/${deliveryId}/pick-up`, { headers: authHeader(driverToken) }),
      () => request.get('delivery/history', { headers: authHeader(driverToken) }),
    ];
    for (const llamar of rutas) {
      const res = await llamar();
      expect(res.ok(), `la ruta respondió ${res.status()}: ${await res.text()}`).toBeTruthy();
      expect(await res.text()).not.toContain('confirmationCode');
    }
  });

  test('el staff SÍ lo ve — lo necesita para dictárselo al cliente', async ({ request }) => {
    const res = await request.get(`delivery/${deliveryId}`, { headers: authHeader(ownerToken) });
    const body = (await res.json()) as { confirmationCode: string };
    expect(body.confirmationCode).toMatch(/^\d{4}$/);
  });

  test('y el mecanismo sigue funcionando: código malo rechaza, bueno cierra', async ({ request }) => {
    // Se lleva la entrega a PICKED_UP acá mismo en vez de depender de que el
    // test anterior haya corrido: si no, ejecutar este solo daba 409 (transición
    // inválida) antes de llegar a validar el código.
    const estado = (await (
      await request.get(`delivery/${deliveryId}`, { headers: authHeader(ownerToken) })
    ).json()) as { status: string; confirmationCode: string };
    if (estado.status === 'DRIVER_ASSIGNED') {
      await request.post(`delivery/${deliveryId}/accept`, { headers: authHeader(driverToken) });
    }
    if (estado.status !== 'PICKED_UP') {
      await request.post(`delivery/${deliveryId}/pick-up`, { headers: authHeader(driverToken) });
    }

    const { confirmationCode } = (await (
      await request.get(`delivery/${deliveryId}`, { headers: authHeader(ownerToken) })
    ).json()) as { confirmationCode: string };

    const malo = await request.post(`delivery/${deliveryId}/deliver`, {
      headers: authHeader(driverToken),
      data: { confirmationCode: '0000' },
    });
    expect(malo.status()).toBe(400);

    const bueno = await request.post(`delivery/${deliveryId}/deliver`, {
      headers: authHeader(driverToken),
      data: { confirmationCode },
    });
    expect(bueno.ok()).toBeTruthy();
    expect((await bueno.json()).status).toBe('DELIVERED');
  });

  test('un repartidor no puede leer ni cancelar la entrega de otro', async ({ request }) => {
    const stamp = Date.now().toString().slice(-6);
    const otroEmail = `e2e-otro-${stamp}@chillberry-demo.test`;
    await request.post('delivery/drivers', {
      headers: authHeader(ownerToken),
      data: {
        name: 'E2E Otro',
        email: otroEmail,
        password: 'Chillberry123!',
        phone: `+59598200${stamp}`,
        vehicleType: 'MOTORCYCLE',
      },
    });
    const otroToken = await login(request, { email: otroEmail, password: 'Chillberry123!' });
    const ajena = await crearDeliveryAsignadoA(request, ownerToken, branchId, driverId);

    const leer = await request.get(`delivery/${ajena}`, { headers: authHeader(otroToken) });
    expect(leer.status()).toBe(403);

    const cancelar = await request.patch(`delivery/${ajena}/status`, {
      headers: authHeader(otroToken),
      data: { status: 'DRIVER_CANCELLED', reason: 'intento de sabotaje e2e' },
    });
    expect(cancelar.status()).toBe(403);

    const incidente = await request.post(`delivery/${ajena}/incidents`, {
      headers: authHeader(otroToken),
      data: { type: 'OTHER', description: 'incidente ajeno e2e' },
    });
    expect(incidente.status()).toBe(403);
  });
});

/** Crea un pedido de delivery por el link público y lo asigna a mano al driver. */
async function crearDeliveryAsignadoA(
  request: APIRequestContext,
  ownerToken: string,
  branchId: string,
  driverId: string,
): Promise<string> {
  const branches = (await (
    await request.get('branches', { headers: authHeader(ownerToken) })
  ).json()) as { id: string; publicSlug: string | null }[];
  const slug = branches.find((b) => b.publicSlug)?.publicSlug;
  if (!slug) throw new Error('Ninguna sucursal tiene link público — ¿corriste el seed?');

  const menu = (await (await request.get(`public/menu/branch/${slug}`)).json()) as {
    categories: { items: { id: string; soldOut?: boolean; modifierGroups?: unknown[] }[] }[];
  };
  const item = menu.categories
    .flatMap((c) => c.items)
    .find((i) => !i.soldOut && !i.modifierGroups?.length);
  if (!item) throw new Error('No hay ítem simple en la carta pública');

  const pedido = await request.post(`public/menu/branch/${slug}/order`, {
    data: {
      fulfillment: 'DELIVERY',
      customerName: 'E2E Seguridad',
      customerPhone: '+595981000999',
      address: 'Av. España 1234',
      items: [{ menuItemId: item.id, quantity: 1 }],
      turnstileToken: 'e2e-test-token',
    },
  });
  const { deliveryId } = (await pedido.json()) as { deliveryId: string };

  // La auto-asignación elige cualquier repartidor ONLINE del tenant: se
  // reasigna a mano para que el test sea determinista.
  await request.post(`delivery/assign/${deliveryId}`, {
    headers: authHeader(ownerToken),
    data: { driverId },
  });
  return deliveryId;
}

test.describe('seguridad: el repartidor no puede calificarse a sí mismo', () => {
  /**
   * El link de seguimiento usaba el ID del delivery — la misma clave que el
   * repartidor ve en sus propias entregas. Como además es él quien dispara el
   * "entregado", podía ponerse 5/5 antes que el cliente: se subía el promedio
   * con el que el sistema le reparte más pedidos, y dejaba al cliente sin poder
   * calificar (es una sola vez por entrega).
   *
   * Ahora el link lleva un `trackingToken` aparte, que sólo tiene quien hizo el
   * pedido. Estos tests fijan las dos mitades: el token no se le filtra al
   * repartidor, y el id ya no sirve para calificar.
   */
  let ownerToken: string;
  let driverToken: string;
  let deliveryId: string;
  let trackingToken: string;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: process.env.E2E_API_BASE_URL ?? 'http://localhost:3001/api/',
    });
    ownerToken = await login(request, OWNER_CREDENTIALS);

    const activos = await request.get('delivery?status=DELIVERED', { headers: authHeader(ownerToken) });
    const lista = (await activos.json()) as Array<{ id: string; trackingToken?: string }>;
    if (lista.length > 0) {
      deliveryId = lista[0]!.id;
      trackingToken = lista[0]!.trackingToken ?? '';
    }
    await request.dispose();
  });

  test('el id del delivery YA NO sirve para calificar', async ({ request }) => {
    test.skip(!deliveryId, 'no hay entregas completadas en el tenant demo');
    const res = await request.post(`track/${deliveryId}/rate`, { data: { rating: 5 } });
    expect(
      res.status(),
      'calificar con el id tiene que fallar: es la clave que conoce el repartidor',
    ).toBe(404);
  });

  test('ninguna ruta del repartidor devuelve el trackingToken', async ({ request }) => {
    const rutas = ['delivery/orders/available', 'delivery/orders/history'];
    for (const ruta of rutas) {
      const res = await request.get(ruta, { headers: authHeader(driverToken ?? ownerToken) });
      if (!res.ok()) continue;
      const cuerpo = await res.text();
      expect(cuerpo, `${ruta} filtró el trackingToken al repartidor`).not.toContain('trackingToken');
    }
  });

  test('el token sí abre el seguimiento del cliente', async ({ request }) => {
    test.skip(!trackingToken, 'sin token para probar');
    const res = await request.get(`track/${trackingToken}`);
    expect(res.ok(), 'el cliente tiene que poder seguir su pedido con el token').toBeTruthy();
  });
});
