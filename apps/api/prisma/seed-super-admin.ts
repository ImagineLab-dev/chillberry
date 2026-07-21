/**
 * Crea (o actualiza) el usuario SUPER_ADMIN — staff interno de Smartia.
 *
 *   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... pnpm --filter @chillberry/api prisma:seed-super-admin
 *
 * ¿Por qué un script y no un endpoint? Porque un endpoint para crear super
 * admins es un agujero de escalada de privilegios: quien pueda llamarlo se
 * auto-promueve y pasa a ver los datos de TODOS los tenants. No hay forma
 * segura de exponerlo por API — el único control real es "hay que tener acceso
 * al server y a la DB". Por eso `CreateUserDto` sigue rechazando SUPER_ADMIN
 * (`@IsIn(STAFF_ROLES)`) y no se toca.
 *
 * Idempotente: se puede correr de nuevo para rotar la contraseña.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SYSTEM_TENANT_SLUG } from '../src/modules/super-admin/super-admin.constants';

const prisma = new PrismaClient();

const EMAIL = process.env.SUPER_ADMIN_EMAIL;
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const NAME = process.env.SUPER_ADMIN_NAME ?? 'Super Admin';

const MIN_PASSWORD_LENGTH = 12;

async function main() {
  if (!EMAIL || !PASSWORD) {
    throw new Error(
      'Faltan SUPER_ADMIN_EMAIL y/o SUPER_ADMIN_PASSWORD.\n' +
        'Uso: SUPER_ADMIN_EMAIL=ops@smartia.com.es SUPER_ADMIN_PASSWORD=<larga> pnpm --filter @chillberry/api prisma:seed-super-admin',
    );
  }
  // Más exigente que los 8 de CreateUserDto: esta credencial abre los datos de
  // TODOS los clientes, no los de un restaurante. No se pone default a
  // propósito — un super admin con contraseña conocida del repo es peor que
  // no tener panel.
  if (PASSWORD.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SUPER_ADMIN_PASSWORD tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  const email = EMAIL.toLowerCase();

  // `User.tenantId` es NOT NULL y toda la cadena de auth asume que un JWT trae
  // tenantId (jwt.strategy tira 401 si falta). En vez de hacer la columna
  // nullable —que es la garantía sobre la que se apoya el aislamiento— el
  // super admin cuelga de un tenant propio y vacío. Ver SYSTEM_TENANT_SLUG.
  const systemTenant = await prisma.tenant.upsert({
    where: { slug: SYSTEM_TENANT_SLUG },
    update: {},
    create: {
      name: 'Smartia (sistema)',
      slug: SYSTEM_TENANT_SLUG,
      countryCode: 'PY',
      currency: 'PYG',
      timezone: 'America/Asuncion',
    },
  });

  // A propósito SIN Subscription: no es un cliente del SaaS. Los listados y
  // métricas del panel lo excluyen por slug (ver NOT_SYSTEM_TENANT).

  const passwordHash = await argon2.hash(PASSWORD);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.tenantId !== systemTenant.id) {
    throw new Error(
      `El email ${email} ya existe y pertenece al tenant ${existing.tenantId} (rol ${existing.role}). ` +
        'No se promueve un usuario de un tenant a SUPER_ADMIN — usá un email dedicado del staff de Smartia.',
    );
  }

  const user = await prisma.user.upsert({
    where: { email },
    // Re-correr el script rota la contraseña y reactiva la cuenta.
    update: { passwordHash, name: NAME, role: 'SUPER_ADMIN', active: true },
    create: {
      tenantId: systemTenant.id,
      email,
      passwordHash,
      name: NAME,
      role: 'SUPER_ADMIN',
    },
  });

  console.log('Super admin listo');
  console.log(`  Email:  ${user.email}`);
  console.log(`  Rol:    ${user.role}`);
  console.log(`  Tenant: ${systemTenant.name} (${systemTenant.slug}) — excluido de listados y métricas`);
  console.log('  Panel:  /super-admin');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
