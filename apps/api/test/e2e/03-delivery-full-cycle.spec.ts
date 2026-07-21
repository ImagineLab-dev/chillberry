import { test, expect } from '@playwright/test';
import { authHeader, getFirstBranch, getFirstMenuItem, login, OWNER_CREDENTIALS } from './helpers';

/**
 * Flujo 4 del checklist original: delivery acepta -> recoge -> entrega con
 * código -> tracking del cliente refleja el estado. Completamente
 * autocontenido (registra su propio repartidor y su propia zona) para no
 * depender de datos de delivery creados a mano en sesiones anteriores — así
 * corre igual sobre una base recién sembrada en CI.
 */
test.describe.serial('delivery: asignación -> aceptar -> recoger -> entregar -> tracking', () => {
  let ownerToken: string;
  let driverToken: string;
  let driverId: string;
  let branchId: string;
  let zoneId: string;
  let deliveryId: string;
  let confirmationCode: string;
  let trackingToken: string;

  let driverUserId: string | undefined;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);
  });

  /**
   * El repartidor de este test es un User y consume cupo del plan. Sin esta
   * limpieza, cada corrida deja uno activo para siempre: llegaron a acumularse
   * 20 y el tenant demo terminó en 25 usuarios sobre un plan de 15 — el propio
   * test se rompía solo a partir de cierta cantidad de corridas.
   */
  test.afterAll(async ({ request }) => {
    if (!driverUserId) return;
    await request.patch(`users/${driverUserId}`, {
      headers: authHeader(ownerToken),
      data: { active: false },
    });
  });

  test('registrar un repartidor y ponerlo ONLINE', async ({ request }) => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const driverEmail = `e2e-driver-${suffix}@chillberry-demo.test`;
    const driverPassword = 'E2eDriver123!';

    const registerRes = await request.post('delivery/drivers', {
      headers: authHeader(ownerToken),
      data: {
        name: 'E2E Driver',
        email: driverEmail,
        password: driverPassword,
        phone: '+595981000000',
        vehicleType: 'MOTORCYCLE',
      },
    });
    expect(registerRes.ok()).toBeTruthy();
    driverUserId = (await registerRes.json()).userId;

    driverToken = await login(request, { email: driverEmail, password: driverPassword });

    const onlineRes = await request.patch('delivery/drivers/me/availability', {
      headers: authHeader(driverToken),
      data: { availability: 'ONLINE' },
    });
    expect(onlineRes.ok()).toBeTruthy();
    expect((await onlineRes.json()).availability).toBe('ONLINE');

    const meRes = await request.get('delivery/drivers/me', { headers: authHeader(driverToken) });
    expect(meRes.ok()).toBeTruthy();
    driverId = (await meRes.json()).id;
  });

  test('crear una zona de delivery para la sucursal', async ({ request }) => {
    const branch = await getFirstBranch(request, ownerToken);
    branchId = branch.id;

    const zoneRes = await request.post('delivery/zones', {
      headers: authHeader(ownerToken),
      data: {
        branchId,
        name: 'Zona E2E',
        feeType: 'FIXED',
        baseFee: 5000,
        estimatedMinutes: 25,
      },
    });
    expect(zoneRes.ok()).toBeTruthy();
    zoneId = (await zoneRes.json()).id;
  });

  test('crear un pedido DELIVERY, pedir el envío y asignarlo explícitamente al repartidor de este test', async ({
    request,
  }) => {
    const menuItem = await getFirstMenuItem(request, ownerToken, branchId);
    const orderRes = await request.post('orders', {
      headers: authHeader(ownerToken),
      data: {
        branchId,
        type: 'DELIVERY',
        customerPhone: '+595981555000',
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      },
    });
    expect(orderRes.ok()).toBeTruthy();
    const orderId = (await orderRes.json()).id;

    const deliveryRes = await request.post(`delivery/orders/${orderId}/request`, {
      headers: authHeader(ownerToken),
      data: { zoneId, addressLine: 'Calle E2E 789' },
    });
    expect(deliveryRes.ok()).toBeTruthy();
    const delivery = await deliveryRes.json();
    deliveryId = delivery.id;
    confirmationCode = delivery.confirmationCode;
    // El seguimiento del cliente va por token, no por el id del delivery.
    trackingToken = delivery.trackingToken;
    expect(trackingToken).toMatch(/^[a-f0-9]{32}$/);
    expect(confirmationCode).toMatch(/^\d{4}$/);

    // El auto-assign puede haber elegido CUALQUIER repartidor ONLINE del
    // tenant demo (puede haber otros de corridas manuales previas) — se
    // fuerza la asignación al repartidor de ESTE test explícitamente en vez
    // de asumir que el algoritmo lo eligió a él, para que el resto del flujo
    // (aceptar/recoger/entregar con ESTE driverToken) sea determinístico.
    const assignRes = await request.post(`delivery/assign/${deliveryId}`, {
      headers: authHeader(ownerToken),
      data: { driverId },
    });
    expect(assignRes.ok()).toBeTruthy();
    const assigned = await assignRes.json();
    expect(assigned.status).toBe('DRIVER_ASSIGNED');
    expect(assigned.driverId).toBe(driverId);
  });

  test('el repartidor acepta y recoge -> el tracking público muestra estado y ubicación', async ({ request }) => {
    const acceptRes = await request.post(`delivery/${deliveryId}/accept`, { headers: authHeader(driverToken) });
    expect(acceptRes.ok()).toBeTruthy();
    expect((await acceptRes.json()).status).toBe('ACCEPTED');

    const trackingDuringAccepted = await request.get(`track/${trackingToken}`);
    expect(trackingDuringAccepted.ok()).toBeTruthy();
    const trackedAccepted = await trackingDuringAccepted.json();
    expect(trackedAccepted.status).toBe('ACCEPTED');
    // Trackable: el nombre del repartidor se expone; el teléfono nunca.
    expect(trackedAccepted.driverName).toBeTruthy();
    expect(trackedAccepted.driverPhone).toBeUndefined();

    const pickUpRes = await request.post(`delivery/${deliveryId}/pick-up`, { headers: authHeader(driverToken) });
    expect(pickUpRes.ok()).toBeTruthy();
    expect((await pickUpRes.json()).status).toBe('PICKED_UP');
  });

  test('entregar con el código de confirmación correcto -> tracking final DELIVERED', async ({ request }) => {
    const wrongCodeRes = await request.post(`delivery/${deliveryId}/deliver`, {
      headers: authHeader(driverToken),
      data: { confirmationCode: '0000' },
    });
    expect(wrongCodeRes.ok()).toBeFalsy();
    expect(wrongCodeRes.status()).toBe(400);

    const deliverRes = await request.post(`delivery/${deliveryId}/deliver`, {
      headers: authHeader(driverToken),
      data: { confirmationCode },
    });
    expect(deliverRes.ok()).toBeTruthy();
    expect((await deliverRes.json()).status).toBe('DELIVERED');

    const trackingRes = await request.get(`track/${trackingToken}`);
    expect(trackingRes.ok()).toBeTruthy();
    const tracked = await trackingRes.json();
    expect(tracked.status).toBe('DELIVERED');
  });
});
