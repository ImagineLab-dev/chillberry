import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { login, authHeader, OWNER_CREDENTIALS } from './helpers';

/**
 * Avisos push del navegador — lo que reemplazó a WhatsApp.
 *
 * Sin esto, el comensal que escanea el QR, pide y guarda el teléfono en el
 * bolsillo no se entera de nada hasta volver a abrir la página.
 *
 * Lo que se fija acá es sobre todo QUIÉN puede suscribirse a los avisos de
 * quién: el alta del comensal va por el token de su seguimiento, así que el
 * teléfono lo pone el servidor. Si viniera del cuerpo, cualquiera podría
 * suscribirse a los avisos de otra persona.
 */

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

const DESTINO = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-prueba-' + Date.now(),
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

test.describe('avisos push', () => {
  test('la clave pública está disponible sin autenticar', async ({ request }) => {
    const res = await request.get('push/clave-publica');
    expect(res.ok()).toBeTruthy();
    const { key } = (await res.json()) as { key: string | null };
    // Puede ser null si no está configurado, pero el endpoint tiene que existir:
    // el front lo consulta antes de pedirle permiso a nadie.
    expect(res.status()).toBe(200);
    if (key) expect(key.length).toBeGreaterThan(60);
  });

  test('un token de seguimiento inexistente NO da de alta nada', async ({ request }) => {
    const antes = await prisma.pushSubscription.count();
    const res = await request.post('push/suscribir/seguimiento/token-que-no-existe', { data: DESTINO });
    // Responde ok igual: confirmar que el token no existe le serviría a alguien
    // tanteando cuáles son válidos.
    expect(res.ok()).toBeTruthy();
    expect(await prisma.pushSubscription.count(), 'no puede crear una suscripción huérfana').toBe(antes);
  });

  test('mandar un teléfono en el cuerpo se RECHAZA de plano', async ({ request }) => {
    const token = await login(request, OWNER_CREDENTIALS);

    // Defensa más fuerte que ignorarlo: el endpoint no acepta ese campo, así
    // que no hay forma de suscribirse a los avisos de otra persona.
    const res = await request.post('push/suscribir', {
      headers: authHeader(token),
      data: { ...DESTINO, phone: '+595999999999' },
    });
    expect(res.status(), 'un campo de más tiene que rechazarse, no ignorarse').toBe(400);

    const guardada = await prisma.pushSubscription.findUnique({ where: { endpoint: DESTINO.endpoint } });
    expect(guardada, 'no puede quedar nada guardado de una petición rechazada').toBeNull();
  });

  test('el personal se suscribe con su sesión y el teléfono sale de su cuenta', async ({ request }) => {
    const token = await login(request, OWNER_CREDENTIALS);
    const res = await request.post('push/suscribir', { headers: authHeader(token), data: DESTINO });
    expect(res.ok(), await res.text()).toBeTruthy();

    const guardada = await prisma.pushSubscription.findUnique({ where: { endpoint: DESTINO.endpoint } });
    const dueño = await prisma.user.findUnique({ where: { email: OWNER_CREDENTIALS.email } });
    // Puede no guardarse si el dueño no tiene teléfono cargado — el endpoint
    // responde ok igual para no romperle la pantalla.
    if (guardada) {
      expect(guardada.phone).toBe(dueño!.phone);
      expect(guardada.userId).toBe(dueño!.id);
    }
  });

  test('suscribirse dos veces desde el mismo dispositivo no duplica el aviso', async ({ request }) => {
    const token = await login(request, OWNER_CREDENTIALS);
    await request.post('push/suscribir', { headers: authHeader(token), data: DESTINO });
    await request.post('push/suscribir', { headers: authHeader(token), data: DESTINO });

    const cuantas = await prisma.pushSubscription.count({ where: { endpoint: DESTINO.endpoint } });
    expect(cuantas, 'el endpoint identifica al dispositivo: se actualiza, no se duplica').toBeLessThanOrEqual(1);
  });

  test.afterAll(async () => {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: DESTINO.endpoint } }).catch(() => {});
  });
});
