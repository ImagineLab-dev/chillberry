-- Planes de suscripción — SEMILLA OBLIGATORIA en cualquier base nueva.
--
-- Las migraciones crean la estructura, no los datos. Sin al menos un plan
-- activo, `POST /auth/verify-signup` revienta con 404 al buscar el plan de
-- entrada — pero DESPUÉS de haber consumido el código de verificación, así que
-- el usuario queda con el código quemado y sin cuenta. Pasó en producción el
-- 21/07/2026, en el primer alta real.
--
-- Se usa SQL y no `prisma/seed.ts` a propósito: ese seed crea además el
-- restaurante de demostración con datos de prueba, que en producción no van.
-- Además la imagen de producción no lleva ts-node, así que un .ts no se podría
-- ejecutar ahí.
--
-- Es idempotente: se puede correr las veces que haga falta.
--
--   docker exec -i <postgres> psql -U chillberry -d chillberry < seed-plans.sql

INSERT INTO plans (id, code, name, price_monthly, currency, limits, features, active, sort_order)
VALUES
  (gen_random_uuid(), 'STARTER', 'Starter', 29, 'USD',
   '{"maxBranches": 1, "maxUsers": 5}'::jsonb,
   '{"delivery": true, "push": true, "invoicing": true}'::jsonb, true, 0),
  (gen_random_uuid(), 'PRO', 'Pro', 79, 'USD',
   '{"maxBranches": 3, "maxUsers": 15}'::jsonb,
   '{"delivery": true, "push": true, "invoicing": true}'::jsonb, true, 1),
  (gen_random_uuid(), 'ENTERPRISE', 'Enterprise', 199, 'USD',
   '{"maxBranches": 10, "maxUsers": 50}'::jsonb,
   '{"delivery": true, "push": true, "invoicing": true}'::jsonb, true, 2)
ON CONFLICT (code) DO UPDATE SET
  name          = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  currency      = EXCLUDED.currency,
  limits        = EXCLUDED.limits,
  features      = EXCLUDED.features,
  active        = EXCLUDED.active,
  sort_order    = EXCLUDED.sort_order;

-- El plan de entrada es el de `sort_order` más bajo entre los activos: es el
-- que `BillingService.getDefaultPlan` le asigna a cada restaurante nuevo.
SELECT code, name, price_monthly, sort_order, active FROM plans ORDER BY sort_order;
