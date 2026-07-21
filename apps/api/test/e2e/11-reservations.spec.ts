import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Reservas de mesa — reemplaza el cuaderno del local. Crear, confirmar, y
 * SENTAR (que ocupa la mesa asignada, como abrir una mesa desde el mapa).
 */
test.describe.serial('reservas de mesa', () => {
  let token: string;
  let branchId: string;
  let reservationId: string;
  let tableId: string;

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  test.beforeAll(async ({ request }) => {
    token = await login(request, OWNER_CREDENTIALS);
    branchId = (await getFirstBranch(request, token)).id;
    // Crea una mesa propia para el test: las del seed suelen quedar OCCUPIED
    // por otras corridas, y el seating necesita una mesa libre determinística.
    const created = await request.post('tables', {
      headers: authHeader(token),
      data: { branchId, code: `RESV-${Math.random().toString(36).slice(2, 7)}` },
    });
    expect(created.ok()).toBeTruthy();
    tableId = (await created.json()).id;
  });

  test('rechaza una reserva para una fecha pasada', async ({ request }) => {
    const res = await request.post('reservations', {
      headers: authHeader(token),
      data: { branchId, customerName: 'Error de fecha', partySize: 2, reservedFor: past },
    });
    expect(res.status()).toBe(400);
  });

  test('crea una reserva (sin mesa asignada) en estado PENDING', async ({ request }) => {
    const res = await request.post('reservations', {
      headers: authHeader(token),
      data: {
        branchId,
        customerName: 'Familia López',
        customerPhone: '+595981555000',
        partySize: 8,
        reservedFor: future,
        notes: 'Cumpleaños',
      },
    });
    expect(res.ok()).toBeTruthy();
    const r = await res.json();
    reservationId = r.id;
    expect(r.status).toBe('PENDING');
    expect(r.partySize).toBe(8);
  });

  test('la reserva aparece en el listado de la sucursal', async ({ request }) => {
    const res = await request.get('reservations', { headers: authHeader(token), params: { branchId } });
    expect(res.ok()).toBeTruthy();
    const list = (await res.json()) as { id: string }[];
    expect(list.some((r) => r.id === reservationId)).toBe(true);
  });

  test('confirmar cambia el estado a CONFIRMED', async ({ request }) => {
    const res = await request.patch(`reservations/${reservationId}`, {
      headers: authHeader(token),
      data: { status: 'CONFIRMED' },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).toBe('CONFIRMED');
  });

  test('SENTAR con una mesa asignada la ocupa', async ({ request }) => {
    const res = await request.patch(`reservations/${reservationId}`, {
      headers: authHeader(token),
      data: { status: 'SEATED', tableId },
    });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).toBe('SEATED');

    const tables = await request.get('tables', { headers: authHeader(token), params: { branchId } });
    const table = ((await tables.json()) as { id: string; status: string }[]).find((t) => t.id === tableId);
    expect(table?.status).toBe('OCCUPIED');
  });

  test('un DRIVER no puede crear reservas', async ({ request }) => {
    // Registrar un driver desechable y desactivarlo al final.
    const email = `resv-driver-${Math.random().toString(36).slice(2, 8)}@chillberry-demo.test`;
    const reg = await request.post('delivery/drivers', {
      headers: authHeader(token),
      data: { name: 'Driver Resv', email, password: 'Chillberry123!', phone: '+595981000000', vehicleType: 'MOTORCYCLE' },
    });
    const driverUserId = (await reg.json()).userId;

    const driverToken = await login(request, { email, password: 'Chillberry123!' });
    const res = await request.post('reservations', {
      headers: authHeader(driverToken),
      data: { branchId, customerName: 'x', partySize: 2, reservedFor: future },
    });
    expect(res.status()).toBe(403);

    await request.patch(`users/${driverUserId}`, { headers: authHeader(token), data: { active: false } });
  });
});
