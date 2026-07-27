-- Overrides de límites por-tenant que fija el super-admin (más sucursales/
-- usuarios que el plan). NULL = usar el límite del plan.
ALTER TABLE "subscriptions" ADD COLUMN "max_branches_override" INTEGER;
ALTER TABLE "subscriptions" ADD COLUMN "max_users_override" INTEGER;
