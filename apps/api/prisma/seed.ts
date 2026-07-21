/**
 * Seed Fase 0 — tenant demo + owner + restaurant + branch + tables + menú
 * mínimo, para poder probar el flujo completo a mano sin tener que pasar
 * por /auth/register primero.
 *
 * Idempotente (upsert) — se puede correr múltiples veces sin duplicar.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@chillberry-demo.test';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'Chillberry123!';

// Fase 6 (SaaS billing): catálogo de planes. `sortOrder` más bajo = plan por
// defecto que recibe una Tenant nueva en TRIAL (ver AuthService.register ->
// BillingService.getDefaultPlan).
const PLANS = [
  {
    code: 'STARTER',
    name: 'Starter',
    priceMonthly: 29,
    sortOrder: 0,
    limits: { maxBranches: 1, maxUsers: 5 },
    // Delivery, avisos y facturación van en los tres planes: lo que cambia
    // entre planes es la escala (sucursales/usuarios), no estas features.
    features: { delivery: true, push: true, invoicing: true },
  },
  {
    code: 'PRO',
    name: 'Pro',
    priceMonthly: 79,
    sortOrder: 1,
    limits: { maxBranches: 3, maxUsers: 15 },
    features: { delivery: true, push: true, invoicing: true },
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    priceMonthly: 199,
    sortOrder: 2,
    limits: { maxBranches: 10, maxUsers: 50 },
    features: { delivery: true, push: true, invoicing: true },
  },
] as const;

async function main() {
  const planByCode = new Map<string, { id: string }>();
  for (const p of PLANS) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      update: {
        name: p.name,
        priceMonthly: p.priceMonthly,
        sortOrder: p.sortOrder,
        limits: p.limits,
        features: p.features,
      },
      create: {
        code: p.code,
        name: p.name,
        priceMonthly: p.priceMonthly,
        sortOrder: p.sortOrder,
        limits: p.limits,
        features: p.features,
      },
    });
    planByCode.set(p.code, plan);
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'chillberry-demo' },
    update: {},
    create: {
      name: 'Chillberry Demo',
      slug: 'chillberry-demo',
      countryCode: 'PY',
      timezone: 'America/Asuncion',
    },
  });

  const passwordHash = await argon2.hash(OWNER_PASSWORD);
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      tenantId: tenant.id,
      email: OWNER_EMAIL,
      passwordHash,
      name: 'Owner Demo',
      role: 'OWNER',
    },
  });

  // Fase 6: el tenant demo se crea directo por seed (no pasa por
  // AuthService.register), así que necesita su Subscription a mano. Se deja
  // en ACTIVE/PRO (en vez de TRIAL) para poder probar a mano el estado
  // "ya suscripto" sin tener que pasar primero por /billing/subscribe.
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      planId: planByCode.get('PRO')!.id,
      status: 'ACTIVE',
      renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const restaurant =
    (await prisma.restaurant.findFirst({ where: { tenantId: tenant.id } })) ??
    (await prisma.restaurant.create({
      data: { tenantId: tenant.id, name: 'Chillberry Burger House' },
    }));

  const branch =
    (await prisma.branch.findFirst({ where: { restaurantId: restaurant.id } })) ??
    (await prisma.branch.create({
      data: {
        tenantId: tenant.id,
        restaurantId: restaurant.id,
        name: 'Sucursal Centro',
        address: 'Av. Central 123, Asunción',
      },
    }));

  for (const code of ['1', '2', '3']) {
    await prisma.table.upsert({
      where: { branchId_code: { branchId: branch.id, code } },
      update: {},
      create: {
        tenantId: tenant.id,
        branchId: branch.id,
        code,
        qrToken: `demo-qr-${branch.id.slice(0, 8)}-${code}`,
        capacity: 4,
      },
    });
  }

  const category =
    (await prisma.menuCategory.findFirst({ where: { branchId: branch.id, name: 'Hamburguesas' } })) ??
    (await prisma.menuCategory.create({
      data: { tenantId: tenant.id, branchId: branch.id, name: 'Hamburguesas', sortOrder: 0 },
    }));

  // Fase 1 (KDS): estaciones estándar + asignación por producto, así el
  // seed deja el Kanban con más de una columna activa para probar a mano.
  const STATIONS: { type: 'HOT_KITCHEN' | 'DRINKS' | 'DESSERTS' | 'GRILL'; name: string }[] = [
    { type: 'HOT_KITCHEN', name: 'Cocina caliente' },
    { type: 'DRINKS', name: 'Bebidas' },
    { type: 'DESSERTS', name: 'Postres' },
    { type: 'GRILL', name: 'Parrilla' },
  ];
  const stationByType = new Map<string, { id: string }>();
  for (const s of STATIONS) {
    const station = await prisma.kitchenStation.upsert({
      where: { branchId_type: { branchId: branch.id, type: s.type } },
      update: {},
      create: { tenantId: tenant.id, branchId: branch.id, type: s.type, name: s.name },
    });
    stationByType.set(s.type, station);
  }

  const items = [
    { name: 'Hamburguesa Clásica', price: 25000, station: 'GRILL' },
    { name: 'Papas Fritas', price: 12000, station: 'HOT_KITCHEN' },
    { name: 'Refresco', price: 8000, station: 'DRINKS' },
  ] as const;
  for (const item of items) {
    const existing = await prisma.menuItem.findFirst({
      where: { branchId: branch.id, name: item.name },
    });
    if (!existing) {
      await prisma.menuItem.create({
        data: {
          tenantId: tenant.id,
          branchId: branch.id,
          categoryId: category.id,
          stationId: stationByType.get(item.station)!.id,
          name: item.name,
          price: item.price,
        },
      });
    } else if (!existing.stationId) {
      await prisma.menuItem.update({
        where: { id: existing.id },
        data: { stationId: stationByType.get(item.station)!.id },
      });
    }
  }

  console.log('Seed OK');
  console.log(`  Tenant:  ${tenant.name} (${tenant.slug})`);
  console.log(`  Owner:   ${owner.email} / ${OWNER_PASSWORD}`);
  console.log(`  Branch:  ${branch.name} (${branch.id})`);
  console.log(`  Plans:   ${PLANS.map((p) => p.code).join(', ')}`);
  console.log('  Subscription: ACTIVE / PRO');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
