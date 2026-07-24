import { test, expect, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { login, OWNER_CREDENTIALS, authHeader } from './helpers';

/**
 * Invitación al equipo por mail.
 *
 * El dueño da de alta a alguien SIN contraseña: la cuenta se crea "a medias"
 * (invitación pendiente, no puede entrar) y le llega un mail con un link para
 * que fije su propia clave. Con SMTP en sandbox el mail no se envía, así que el
 * token se lee de la base — que es exactamente donde vive para el link real.
 *
 * Lo que se protege:
 *  - el token NUNCA sale por la API (sólo un booleano `invitePending`);
 *  - sin aceptar, la cuenta no entra;
 *  - el token es de un solo uso (aceptar dos veces falla);
 *  - dar de alta CON contraseña sigue funcionando como antes (no rompimos eso).
 */
const prisma = new PrismaClient();

// Sufijo único por corrida para no chocar con datos de otras corridas ni gastar
// el límite de usuarios del plan con basura acumulada.
const stamp = Date.now().toString().slice(-9);
const emailInvitado = `e2e-invite-${stamp}@chillberry-demo.test`;
const emailDirecto = `e2e-directo-${stamp}@chillberry-demo.test`;
const CLAVE = 'Chillberry123!';

async function tokenDe(email: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { invitationToken: true },
  });
  return u?.invitationToken ?? null;
}

test.afterAll(async () => {
  // Limpieza: estas cuentas de prueba nunca operan, así que el borrado duro pasa.
  // Sin esto, cada corrida deja usuarios que consumen el límite del plan demo.
  await prisma.user.deleteMany({
    where: { email: { in: [emailInvitado.toLowerCase(), emailDirecto.toLowerCase()] } },
  });
  await prisma.$disconnect();
});

test.describe('invitación al equipo por mail', () => {
  let ownerToken: string;

  test.beforeAll(async ({ request }) => {
    ownerToken = await login(request, OWNER_CREDENTIALS);
  });

  test('crear SIN contraseña deja la cuenta como invitación pendiente y NO filtra el token', async ({
    request,
  }) => {
    const res = await request.post('users', {
      headers: authHeader(ownerToken),
      data: { name: 'E2E Invitado', email: emailInvitado, role: 'WAITER' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    const body = (await res.json()) as Record<string, unknown>;
    // La respuesta dice que hay invitación pendiente, pero el token queda adentro.
    expect(body.invitePending).toBe(true);
    expect(body).not.toHaveProperty('invitationToken');
    expect(JSON.stringify(body)).not.toContain('invitation');

    // En la base sí hay un token (es lo que viaja en el link del mail).
    expect(await tokenDe(emailInvitado)).toMatch(/^[a-f0-9]{48}$/);
  });

  test('la lista de equipo marca invitePending sin exponer el token', async ({ request }) => {
    const res = await request.get('users', { headers: authHeader(ownerToken) });
    expect(res.ok()).toBeTruthy();
    const usuarios = (await res.json()) as Array<Record<string, unknown>>;
    const invitado = usuarios.find((u) => u.email === emailInvitado.toLowerCase());
    expect(invitado?.invitePending).toBe(true);
    expect(invitado).not.toHaveProperty('invitationToken');
  });

  test('sin aceptar, la cuenta invitada no puede entrar', async ({ request }) => {
    const res = await request.post('auth/login', {
      data: { email: emailInvitado, password: CLAVE, turnstileToken: 'e2e-test-token' },
    });
    // La clave real es aleatoria e inservible: no hay forma de loguearse todavía.
    expect(res.status()).toBe(401);
  });

  test('GET /auth/invitation devuelve a quién y a qué restaurante corresponde', async ({ request }) => {
    const token = await tokenDe(emailInvitado);
    const res = await request.get(`auth/invitation/${token}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const info = (await res.json()) as { email: string; name: string; tenantName: string };
    expect(info.email).toBe(emailInvitado.toLowerCase());
    expect(info.name).toBe('E2E Invitado');
    expect(info.tenantName).toBeTruthy();
  });

  test('un token inexistente da 401 (no distingue "no existe" de "ya usado")', async ({ request }) => {
    const res = await request.post('auth/accept-invite', {
      data: { token: 'deadbeef'.repeat(6), password: CLAVE },
    });
    expect(res.status()).toBe(401);
  });

  test('aceptar la invitación fija la clave, entra y consume el token', async ({ request }) => {
    const token = (await tokenDe(emailInvitado))!;
    const res = await request.post('auth/accept-invite', { data: { token, password: CLAVE } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const sesion = (await res.json()) as { accessToken: string; refreshToken: string };
    expect(sesion.accessToken).toBeTruthy();
    expect(sesion.refreshToken).toBeTruthy();

    // El token quedó consumido: ya no hay invitación pendiente.
    expect(await tokenDe(emailInvitado)).toBeNull();

    // Ahora sí entra con la clave que eligió.
    const loginRes = await request.post('auth/login', {
      data: { email: emailInvitado, password: CLAVE, turnstileToken: 'e2e-test-token' },
    });
    expect(loginRes.ok()).toBeTruthy();
  });

  test('el mismo token no sirve dos veces', async ({ request }) => {
    // El token ya fue consumido en el test anterior: reintentar con él falla.
    const res = await request.post('auth/accept-invite', {
      data: { token: 'a'.repeat(48), password: CLAVE },
    });
    expect(res.status()).toBe(401);
  });

  test('una invitación VENCIDA no sirve, y reenviarla la revive con OTRO token', async ({ request }) => {
    const emailVencido = `e2e-invite-venc-${stamp}@chillberry-demo.test`;
    const crear = await request.post('users', {
      headers: authHeader(ownerToken),
      data: { name: 'E2E Vencido', email: emailVencido, role: 'KITCHEN' },
    });
    expect(crear.ok(), await crear.text()).toBeTruthy();
    const creado = (await crear.json()) as { id: string };

    // Se fuerza el vencimiento (las invitaciones duran 7 días).
    await prisma.user.update({
      where: { email: emailVencido.toLowerCase() },
      data: { invitationExpiresAt: new Date(Date.now() - 60_000) },
    });
    const tokenVencido = (await tokenDe(emailVencido))!;

    // Ni consultar ni aceptar: 401 con el mensaje de vencida.
    const info = await request.get(`auth/invitation/${tokenVencido}`);
    expect(info.status()).toBe(401);
    expect(await info.text()).toContain('venció');
    const aceptar = await request.post('auth/accept-invite', {
      data: { token: tokenVencido, password: CLAVE },
    });
    expect(aceptar.status()).toBe(401);

    // Reenviar: rota el token (el viejo muere) y el nuevo funciona.
    const reenviar = await request.post(`users/${creado.id}/resend-invite`, {
      headers: authHeader(ownerToken),
    });
    expect(reenviar.ok(), await reenviar.text()).toBeTruthy();
    const tokenNuevo = (await tokenDe(emailVencido))!;
    expect(tokenNuevo).not.toBe(tokenVencido);

    const viejoMuerto = await request.post('auth/accept-invite', {
      data: { token: tokenVencido, password: CLAVE },
    });
    expect(viejoMuerto.status()).toBe(401);

    const acepta = await request.post('auth/accept-invite', {
      data: { token: tokenNuevo, password: CLAVE },
    });
    expect(acepta.ok(), await acepta.text()).toBeTruthy();

    // Con la cuenta ya activa, reenviar da 409 (no hay invitación pendiente).
    const tarde = await request.post(`users/${creado.id}/resend-invite`, {
      headers: authHeader(ownerToken),
    });
    expect(tarde.status()).toBe(409);

    // Limpieza: la cuenta de prueba nunca operó — borrado duro pasa.
    await prisma.user.deleteMany({ where: { email: emailVencido.toLowerCase() } }).catch(() => {});
  });

  test('crear CON contraseña sigue creando la cuenta lista para entrar', async ({ request }) => {
    const res = await request.post('users', {
      headers: authHeader(ownerToken),
      data: { name: 'E2E Directo', email: emailDirecto, password: CLAVE, role: 'CASHIER' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.invitePending).toBe(false);

    // Sin invitación de por medio: entra directo con la clave que puso el dueño.
    const loginRes = await request.post('auth/login', {
      data: { email: emailDirecto, password: CLAVE, turnstileToken: 'e2e-test-token' },
    });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
  });
});
