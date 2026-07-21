import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

/**
 * Alta de cuenta y recuperación con código por mail.
 *
 * En los tests el SMTP está en modo sandbox (el mail se loguea, no se envía),
 * así que el código se lee de la base. Se guarda HASHEADO, así que no se puede
 * "leer" — se prueban los 6 dígitos contra el hash. Que eso sea necesario acá
 * es justamente la prueba de que el código no está en claro en ningún lado.
 */
const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Encuentra el código vigente probando el espacio de 6 dígitos contra el hash. */
async function leerCodigo(email: string, purpose: 'SIGNUP' | 'PASSWORD_RESET'): Promise<string> {
  const registro = await prisma.verificationCode.findFirst({
    where: { email: email.toLowerCase(), purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!registro) throw new Error(`No hay código pendiente para ${email} (${purpose})`);

  for (let i = 0; i < 1_000_000; i++) {
    const candidato = String(i).padStart(6, '0');
    if (createHash('sha256').update(candidato).digest('hex') === registro.codeHash) return candidato;
  }
  throw new Error('El hash guardado no corresponde a ningún código de 6 dígitos');
}

function datosDeAlta(stamp: string) {
  return {
    tenantName: `E2E Resto ${stamp}`,
    ownerName: 'E2E Dueño',
    email: `e2e-alta-${stamp}@chillberry-demo.test`,
    password: 'Chillberry123!',
    countryCode: 'PY',
    turnstileToken: 'e2e-test-token',
  };
}

test.describe('alta de cuenta con código de verificación', () => {
  const stamp = Date.now().toString().slice(-9);
  const alta = datosDeAlta(stamp);

  test('pedir el alta NO crea todavía el restaurante', async ({ request }) => {
    const res = await request.post('auth/register', { data: alta });
    expect(res.ok()).toBeTruthy();
    // No devuelve sesión: sin código verificado no hay cuenta.
    expect(await res.text()).not.toContain('accessToken');

    // Y en la base no existe ni el usuario ni el tenant. Esto es lo que evita
    // que un bot acapare slugs (que son únicos en todo el sistema) sin tener
    // siquiera un correo válido.
    expect(await prisma.user.findUnique({ where: { email: alta.email } })).toBeNull();
    expect(await prisma.tenant.findFirst({ where: { name: alta.tenantName } })).toBeNull();
  });

  test('un código equivocado no crea nada', async ({ request }) => {
    const res = await request.post('auth/verify-signup', {
      data: { email: alta.email, code: '000000' },
    });
    expect(res.status()).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: alta.email } })).toBeNull();
  });

  test('el código correcto crea el restaurante y devuelve la sesión', async ({ request }) => {
    const codigo = await leerCodigo(alta.email, 'SIGNUP');
    const res = await request.post('auth/verify-signup', { data: { email: alta.email, code: codigo } });
    expect(res.ok()).toBeTruthy();

    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();

    const user = await prisma.user.findUnique({ where: { email: alta.email } });
    expect(user).not.toBeNull();
    expect(user!.role).toBe('OWNER');
    // Y con su suscripción de prueba, igual que antes de partir el flujo en dos.
    const sub = await prisma.subscription.findFirst({ where: { tenantId: user!.tenantId } });
    expect(sub?.status).toBe('TRIAL');
  });

  test('el mismo código no sirve dos veces', async ({ request }) => {
    const res = await request.post('auth/verify-signup', {
      data: { email: alta.email, code: '123456' },
    });
    expect(res.status()).toBe(400);
  });

  test('el código se guarda HASHEADO, nunca en claro', async () => {
    const registros = await prisma.verificationCode.findMany({
      where: { email: alta.email },
      select: { codeHash: true },
    });
    expect(registros.length).toBeGreaterThan(0);
    for (const r of registros) {
      // 64 hex = SHA-256. Si fuera el código en claro serían 6 dígitos.
      expect(r.codeHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

test.describe('el código se agota a los 5 intentos', () => {
  const stamp = (Date.now() + 1).toString().slice(-9);
  const alta = datosDeAlta(stamp);

  test('probar códigos al azar mata el código antes de acertar', async ({ request }) => {
    await request.post('auth/register', { data: alta });
    const codigoReal = await leerCodigo(alta.email, 'SIGNUP');

    // Cinco intentos fallidos. Sin este tope, un millón de combinaciones se
    // prueban con un script en minutos.
    for (let i = 0; i < 5; i++) {
      const fallido = String(i).padStart(6, '0') === codigoReal ? '999999' : String(i).padStart(6, '0');
      const res = await request.post('auth/verify-signup', { data: { email: alta.email, code: fallido } });
      expect(res.status()).toBe(400);
    }

    // Y ahora ni el código correcto sirve: quedó quemado.
    const res = await request.post('auth/verify-signup', { data: { email: alta.email, code: codigoReal } });
    expect(res.status()).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: alta.email } })).toBeNull();
  });
});

test.describe('recuperación de cuenta', () => {
  const stamp = (Date.now() + 2).toString().slice(-9);
  const alta = datosDeAlta(stamp);
  const claveNueva = 'OtraClave456!';

  test.beforeAll(async ({ request }) => {
    await request.post('auth/register', { data: alta });
    const codigo = await leerCodigo(alta.email, 'SIGNUP');
    await request.post('auth/verify-signup', { data: { email: alta.email, code: codigo } });
  });

  test('un correo que no existe recibe la MISMA respuesta', async ({ request }) => {
    const existe = await request.post('auth/forgot-password', {
      data: { email: alta.email, turnstileToken: 'e2e-test-token' },
    });
    const noExiste = await request.post('auth/forgot-password', {
      data: { email: `no-existe-${stamp}@chillberry-demo.test`, turnstileToken: 'e2e-test-token' },
    });

    // Si las respuestas difirieran, se podría averiguar qué correos son
    // clientes probando de a uno.
    expect(noExiste.status()).toBe(existe.status());
    expect(await noExiste.text()).toBe(await existe.text());
  });

  test('con el código correcto se cambia la contraseña', async ({ request }) => {
    const codigo = await leerCodigo(alta.email, 'PASSWORD_RESET');
    const res = await request.post('auth/reset-password', {
      data: { email: alta.email, code: codigo, password: claveNueva },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('la contraseña vieja ya no entra y la nueva sí', async ({ request }) => {
    const vieja = await request.post('auth/login', {
      data: { email: alta.email, password: alta.password, turnstileToken: 'e2e-test-token' },
    });
    expect(vieja.status()).toBe(401);

    const nueva = await request.post('auth/login', {
      data: { email: alta.email, password: claveNueva, turnstileToken: 'e2e-test-token' },
    });
    expect(nueva.ok()).toBeTruthy();
  });

  test('recuperar la cuenta corta las sesiones que estaban abiertas', async ({ request }) => {
    // Sesión abierta ANTES de recuperar: hay que asumir que quien te robó la
    // cuenta tiene una viva. Cambiar la clave sin cortarla no lo saca.
    const sesion = await request.post('auth/login', {
      data: { email: alta.email, password: claveNueva, turnstileToken: 'e2e-test-token' },
    });
    const { refreshToken } = (await sesion.json()) as { refreshToken: string };

    await request.post('auth/forgot-password', {
      data: { email: alta.email, turnstileToken: 'e2e-test-token' },
    });
    const codigo = await leerCodigo(alta.email, 'PASSWORD_RESET');
    await request.post('auth/reset-password', {
      data: { email: alta.email, code: codigo, password: 'TerceraClave789!' },
    });

    const refresco = await request.post('auth/refresh', { data: { refreshToken } });
    expect(refresco.status()).toBe(401);
  });
});
