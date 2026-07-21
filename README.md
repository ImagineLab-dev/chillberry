# Chillberry

Plataforma SaaS multi-tenant para restaurantes: menú QR, pedidos, cocina (KDS), meseros, caja/POS, pagos, delivery propio y facturación SaaS.

Monorepo Turborepo + pnpm. Ver `apps/api` (NestJS + Prisma + PostgreSQL) y `apps/web` (Next.js, rutas segmentadas por rol).

## Desarrollo local

```bash
pnpm install
pnpm infra:up                 # levanta postgres + redis (infra/docker-compose.dev.yml)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm --filter @chillberry/api prisma:migrate
pnpm --filter @chillberry/api prisma:seed
pnpm dev                      # levanta api (puerto 3001) + web (puerto 3000)
```

## Estado

- **Fase 0 — Fundación**: Tenant, Auth (JWT access+refresh), Users, Restaurants, Branches, Tables (QR), Menú mínimo, Orders mínimo. ✅
- Fases 1-8 (KDS, Meseros, Caja, Pagos, Delivery, SaaS Billing, Integraciones, DevOps): ver plan en `docs/plan-fases-8-10.md`.
