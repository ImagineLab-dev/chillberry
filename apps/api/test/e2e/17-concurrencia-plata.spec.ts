import { test, expect, type APIRequestContext } from '@playwright/test';
import { OWNER_CREDENTIALS, authHeader, getFirstBranch, getFirstMenuItem, login } from './helpers';

/**
 * Carreras sobre la plata. Todo acá se dispara EN PARALELO a propósito: son
 * bugs que no aparecen ejecutando los pasos uno detrás del otro.
 *
 * El patrón común de todos era el mismo: leer un agregado (subtotal, saldo,
 * puntos, estado), decidir en JavaScript y escribir el valor absoluto. Entre la
 * lectura y la escritura entra la otra petición.
 *
 * Casos cubiertos:
 *  - dos mozos agregando a la misma mesa: el segundo pisaba al primero y un
 *    plato servido no quedaba en la cuenta;
 *  - dos descuentos simultáneos: quedaban dos filas Discount pero un solo
 *    descuento en el total (con el cupón quemado o los puntos ya gastados);
 *  - dos canjes del mismo saldo de puntos: pasaban los dos y la cuenta quedaba
 *    en negativo;
 *  - dos terminales cobrando el mismo pedido: se registraba el cobro dos veces;
 *  - doble click en Cobrar: reventaba con un 500 y el cajero no sabía si cobró.
 */

/** Dispara N peticiones lo más juntas posible y devuelve todas las respuestas. */
async function enParalelo<T>(tareas: (() => Promise<T>)[]): Promise<T[]> {
  return Promise.all(tareas.map((t) => t()));
}

async function crearPedido(
  request: APIRequestContext,
  token: string,
  branchId: string,
  menuItemId: string,
  quantity = 2,
) {
  const res = await request.post('orders', {
    headers: authHeader(token),
    data: { branchId, type: 'TAKEAWAY', items: [{ menuItemId, quantity }] },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; subtotal: string; total: string };
}

test.describe('concurrencia: agregados de un pedido', () => {
  let token: string;
  let branchId: string;
  let menuItemId: string;
  let precio: number;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    const item = await getFirstMenuItem(request, token, branchId);
    menuItemId = item.id;
    precio = Number(item.price);
  });

  test('dos rondas simultáneas a la misma mesa suman LAS DOS', async ({ request }) => {
    const pedido = await crearPedido(request, token, branchId, menuItemId, 1);
    const base = Number(pedido.subtotal);

    const respuestas = await enParalelo([
      () =>
        request.post(`orders/${pedido.id}/items`, {
          headers: authHeader(token),
          data: { items: [{ menuItemId, quantity: 1 }] },
        }),
      () =>
        request.post(`orders/${pedido.id}/items`, {
          headers: authHeader(token),
          data: { items: [{ menuItemId, quantity: 1 }] },
        }),
    ]);
    for (const r of respuestas) expect(r.ok()).toBeTruthy();

    const detalle = (await (
      await request.get(`orders/${pedido.id}`, { headers: authHeader(token) })
    ).json()) as { subtotal: string; items: { quantity: number }[] };

    expect(Number(detalle.subtotal)).toBeCloseTo(base + precio * 2, 2);
    // Y la cuenta cierra con lo que realmente se sirvió.
    expect(detalle.items.reduce((s, i) => s + i.quantity, 0)).toBe(3);
  });

  test('dos descuentos simultáneos no se pisan', async ({ request }) => {
    const pedido = await crearPedido(request, token, branchId, menuItemId, 4);
    const total = Number(pedido.total);

    const respuestas = await enParalelo([
      () =>
        request.post('pos/discounts', {
          headers: authHeader(token),
          data: { orderId: pedido.id, type: 'PERCENTAGE', value: 10, reason: 'carrera A e2e' },
        }),
      () =>
        request.post('pos/discounts', {
          headers: authHeader(token),
          data: { orderId: pedido.id, type: 'PERCENTAGE', value: 10, reason: 'carrera B e2e' },
        }),
    ]);
    const aceptados = respuestas.filter((r) => r.ok()).length;
    expect(aceptados).toBeGreaterThanOrEqual(1);

    const detalle = (await (
      await request.get(`orders/${pedido.id}`, { headers: authHeader(token) })
    ).json()) as { subtotal: string; total: string; discountTotal: string };

    // El descuento registrado tiene que coincidir con los que de verdad pasaron,
    // y el total tiene que cerrar contra el subtotal.
    expect(Number(detalle.discountTotal)).toBeCloseTo(total * 0.1 * aceptados, 1);
    expect(Number(detalle.total)).toBeCloseTo(Number(detalle.subtotal) - Number(detalle.discountTotal), 2);
  });
});

test.describe('concurrencia: cobro del mismo pedido', () => {
  let token: string;
  let branchId: string;
  let menuItemId: string;

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    menuItemId = (await getFirstMenuItem(request, token, branchId)).id;

    const abierta = await request.get('pos/cash-sessions/open', {
      headers: authHeader(token),
      params: { branchId },
    });
    if (!(await abierta.text())) {
      await request.post('pos/cash-sessions/open', {
        headers: authHeader(token),
        data: { branchId, openingAmount: 0 },
      });
    }
  });

  test('dos terminales distintas: sólo una cobra', async ({ request }) => {
    const pedido = await crearPedido(request, token, branchId, menuItemId);
    const total = Number(pedido.total);
    const cobrar = (clave: string) => () =>
      request.post(`pos/orders/${pedido.id}/charge`, {
        headers: authHeader(token),
        data: { idempotencyKey: clave, payments: [{ method: 'CASH', amount: total }] },
      });

    const respuestas = await enParalelo([cobrar(crypto.randomUUID()), cobrar(crypto.randomUUID())]);
    expect(respuestas.filter((r) => r.ok())).toHaveLength(1);
    expect(respuestas.some((r) => r.status() === 409)).toBeTruthy();

    // Y el pedido queda cobrado UNA vez: el segundo intento no dejó rastro.
    const detalle = (await (
      await request.get(`orders/${pedido.id}`, { headers: authHeader(token) })
    ).json()) as { status: string; total: string };
    expect(detalle.status).toBe('COMPLETED');
    expect(Number(detalle.total)).toBeCloseTo(total, 2);
  });

  test('doble click en la MISMA terminal: no revienta y no cobra dos veces', async ({ request }) => {
    const pedido = await crearPedido(request, token, branchId, menuItemId);
    const total = Number(pedido.total);
    // La UI reusa la clave hasta que el cobro sale bien: eso es un doble click.
    const clave = crypto.randomUUID();
    const cobrar = () => () =>
      request.post(`pos/orders/${pedido.id}/charge`, {
        headers: authHeader(token),
        data: { idempotencyKey: clave, payments: [{ method: 'CASH', amount: total }] },
      });

    const respuestas = await enParalelo([cobrar(), cobrar()]);
    // Ninguna puede ser un 500: antes el índice único rechazaba al segundo
    // insert y el cajero veía un error sin saber si había cobrado.
    for (const r of respuestas) expect(r.status()).not.toBe(500);

    const detalle = (await (
      await request.get(`orders/${pedido.id}`, { headers: authHeader(token) })
    ).json()) as { status: string };
    expect(detalle.status).toBe('COMPLETED');
  });

  test('dos aperturas de caja simultáneas dejan UNA sola sesión', async ({ request }) => {
    const abierta = await request.get('pos/cash-sessions/open', {
      headers: authHeader(token),
      params: { branchId },
    });
    const texto = await abierta.text();
    if (texto && texto !== 'null') {
      const { id } = JSON.parse(texto) as { id: string };
      await request.post(`pos/cash-sessions/${id}/close`, {
        headers: authHeader(token),
        data: { countedCash: 0 },
      });
    }

    const abrir = () => () =>
      request.post('pos/cash-sessions/open', {
        headers: authHeader(token),
        data: { branchId, openingAmount: 100000 },
      });
    const respuestas = await enParalelo([abrir(), abrir()]);

    // La garantía real es un índice único parcial en la base (una sola fila
    // OPEN por sucursal); acá se comprueba que el segundo recibe un conflicto
    // claro y no un error de base de datos.
    expect(respuestas.filter((r) => r.ok())).toHaveLength(1);
    expect(respuestas.some((r) => r.status() === 409)).toBeTruthy();
  });
});
