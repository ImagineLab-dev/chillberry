# Checklist de producción — Chillberry

## Resumen ejecutivo

Chillberry es un SaaS multi-tenant para restaurantes (menú QR, pedidos, cocina/KDS, meseros, caja/POS, pagos, delivery propio y facturación SaaS), backend NestJS 11 + Prisma 6 + PostgreSQL (`apps/api`) y frontend Next.js 15 (`apps/web`). Esta revisión verificó, leyendo el código fuente directamente (no por inferencia), el aislamiento multi-tenant, autenticación, manejo de secretos, seguridad de webhooks de pago/billing y RBAC — el detalle está en "Hallazgos" más abajo. A la fecha de esta revisión, DLocal (pagos SaaS), el proveedor de pago de clientes y los avisos push corren en modo sandbox/mock salvo que se configuren credenciales reales; no hay cola de jobs (BullMQ) ni Redis en uso real todavía.

---

## Checklist de pre-producción

### Seguridad

- [ ] `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` regenerados para producción (`openssl rand -hex 64`), distintos entre sí y distintos de cualquier valor usado en dev/staging.
- [ ] `MOCK_PROVIDER_SECRET` y `DLOCAL_WEBHOOK_SECRET` rotados a un valor real generado (ver Hallazgo #1 — **estas dos variables tienen defaults inseguros sin guard de arranque**; si se despliega sin fijarlas explícitamente, el proceso arranca igual con el valor `*-change-me` conocido públicamente).
- [ ] Confirmar que `apps/api/.env` (producción) NO está commiteado — `.gitignore` ya excluye `.env`/`.env.local`, verificar que ningún `.env` real quedó agregado a git en algún commit anterior (`git log --all --full-history -- apps/api/.env`).
- [ ] `WEB_ORIGIN` fijado al dominio real de producción (no `http://localhost:3000`) — el CORS de `main.ts` rechaza cualquier origin fuera de esta lista.
- [ ] TLS/HTTPS terminado en nginx (o equivalente) delante de `apps/api` y `apps/web`; `trust proxy` ya está seteado en `main.ts` asumiendo un proxy delante.
- [ ] Helmet: confirmar que `NODE_ENV=production` en el deploy real (CSP y HSTS en `main.ts` solo se activan cuando `isProd` es true).
- [ ] Rate limiting confirmado en runtime: 60 req/60s y 300 req/5min global (`throttler.module.ts`), 5 req/min en login/register y 30 req/min en refresh (`auth.controller.ts`), 120 req/min en webhooks de pago/billing.
- [ ] `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted` + `transform`) probado contra un payload con campos extra/no declarados — debe rechazar con 400.
- [ ] Revisar si conviene agregar un guard de arranque que aborte el boot en `NODE_ENV=production` si `MOCK_PROVIDER_SECRET`/`DLOCAL_WEBHOOK_SECRET` siguen en su valor default (`*-change-me`).

### Base de datos

- [ ] Backups automatizados configurados y probados end-to-end con `infra/scripts/backup.sh` (dump programado) y `infra/scripts/restore.sh` (restore verificado contra una base de prueba, no solo `--dry-run`).
- [ ] Retención de backups definida (cuántos días/copias) y almacenamiento fuera del mismo host de Postgres.
- [ ] Migraciones de Prisma aplicadas y verificadas en el entorno de producción (`prisma migrate deploy`, no `migrate dev`).
- [ ] Índices de `tenantId` presentes en las tablas de mayor volumen (`Order`, `Payment`, `DriverLocation`, etc. — ya declarados en `schema.prisma`) confirmados en el plan de queries reales antes de ir a producción con datos de volumen.

### Infraestructura

- [ ] Imágenes Docker de `apps/api` (`infra/Dockerfile.api`) y `apps/web` (`infra/Dockerfile.web`) construidas y pusheadas al registry de producción.
- [ ] `docker-compose.prod.yml` creado/revisado — a la fecha de esta revisión solo existe `infra/docker-compose.dev.yml`; falta el compose de producción (puertos, redes, healthchecks, límites de recursos, variables de entorno inyectadas por secret manager y no por archivo plano).
- [ ] Smoke test post-deploy ejecutado y en verde vía `infra/scripts/smoke-test.sh`.
- [ ] `infra/scripts/preflight.sh` ejecutado antes del primer deploy (validación de prerequisitos del host).
- [ ] Healthchecks `/api/health/live` y `/api/health/ready` (este último hace `SELECT 1` contra Postgres) wireados al orquestador (Docker/K8s) para restart automático si fallan.

### Integraciones

- [ ] DLocal: credenciales reales configuradas solo si se va a cobrar suscripciones SaaS reales — mientras no se configuren, el sistema sigue funcionando en modo sandbox (`mock-dlocal.adapter.ts`) sin llamadas externas. Explícitamente opcional para el primer lanzamiento.
- [ ] Proveedor de pago de clientes (pedidos): mismo patrón sandbox (`mock-payment.adapter.ts`) — configurar el proveedor real (Bancard/MercadoPago/Stripe/etc., aún no implementado, solo el mock) cuando se decida cobrar pagos electrónicos reales de pedidos.
- [ ] Avisos push (VAPID): `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` configurados — sin ellos, `push/push.adapter.ts` cae a modo sandbox (loguea el aviso, no lo envía) y el front recibe `key: null` y no muestra el botón. Reemplazaron a WhatsApp.

### Monitoreo

- [ ] `/api/health/live` y `/api/health/ready` wireados a un uptime monitor externo (UptimeRobot, Better Stack, etc.) con alerta a un canal real.
- [ ] Logs JSON estructurados de Pino (`common/logging/logger.ts`) enviados a un destino durable (Loki, CloudWatch, etc.) — actualmente solo van a stdout.
- [ ] Confirmar en el destino de logs elegido que el redact de Pino (`password`, `passwordHash`, `refreshToken`, `accessToken`, `authorization`, `cookie`, `cardNumber`, `cvv`) efectivamente censura esos campos antes de indexarlos (no asumir — probar con un log real que contenga uno de esos campos).
- [ ] Alertas básicas de error rate (respuestas 5xx) y de webhooks con `signatureValid: false` repetidos (posible intento de forjar webhooks).

---

## Hallazgos de la revisión de seguridad

Todo lo siguiente fue verificado leyendo el código fuente directamente (no asumido).

### Sólido — confirmado por lectura de código

- **Aislamiento multi-tenant**: `apps/api/src/prisma/tenant-prisma.service.ts` envuelve el `PrismaClient` con un Client Extension que inyecta `tenantId` automáticamente en `where`/`data` de toda operación (`findMany`, `update`, `delete`, `create`, `upsert`, etc.) sobre los modelos listados en `TENANT_SCOPED_MODELS` (`apps/api/src/prisma/tenant-scoped-models.ts`). Se cruzó esa lista contra **todos** los modelos de `apps/api/prisma/schema.prisma` que tienen columna `tenantId` (31 modelos): los 29 con `tenantId` no-nulo están todos presentes en la lista. Los dos excluidos son intencionales y están documentados en el propio código: `Plan` (catálogo global sin `tenantId`, compartido entre tenants) y `PaymentWebhookEvent` (`tenantId` nullable — los webhooks llegan sin JWT, sin tenant en contexto ALS, así que usan `PrismaService` crudo). **No se encontró ningún modelo tenant-scoped huérfano.**
- **El tenantId nunca viene del cliente**: `tenant-context.middleware.ts` solo abre el store de AsyncLocalStorage; el valor real de `tenantId` se setea exclusivamente en `JwtAuthGuard` (`modules/auth/jwt-auth.guard.ts`) a partir del payload del JWT ya verificado — no hay ningún header ni query param que un cliente pueda usar para influir el tenant activo.
- **Auth**: `argon2.hash`/`argon2.verify` para passwords (`auth.service.ts`). JWT de acceso firmado con `JWT_ACCESS_SECRET`; refresh token es un valor aleatorio de 48 bytes (`randomBytes(48)`) del cual solo se persiste el hash SHA-256 (`tokenHash`) — el token en texto plano nunca toca la base de datos. Rotación confirmada: cada `refresh()` revoca la sesión usada (`revokedAt`) y emite un par nuevo.
- **`main.ts`**: Helmet con CSP y HSTS activados solo en `NODE_ENV=production`; CORS con allowlist explícita vía `WEB_ORIGIN` (rechaza cualquier origin no listado); `ValidationPipe` global con `whitelist: true` + `forbidNonWhitelisted: true` + `transform: true`; body parser con `rawBody` capturado para poder validar firmas HMAC de webhooks contra los bytes exactos recibidos.
- **Rate limiting**: `common/security/throttler.module.ts` registra `ThrottlerGuard` globalmente (60/60s y 300/5min por IP); `auth.controller.ts` sobrescribe con límites más estrictos en `register`/`login` (5/min) y `refresh` (30/min); los webhooks de pago/billing tienen su propio límite de 120/min.
- **Secrets — JWT**: `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` (`config/env.ts`) son `z.string().min(32)` **sin default** — si faltan o son cortos, `loadEnv()` hace `process.exit(1)` al boot. No hay forma de arrancar en un estado inseguro por secretos JWT faltantes.
- **Sin datos de tarjeta**: no existe ningún campo `cardNumber`/`cvv` en `schema.prisma` ni en los módulos `payments`/`billing` (grep confirmado, cero resultados). `Payment.providerPaymentId` y `SubscriptionInvoice.providerPaymentId` son las únicas referencias persistidas, y ambas son IDs tokenizados del proveedor — el comentario en el propio schema lo deja explícito ("NUNCA número de tarjeta/CVV").
- **Logs**: `common/logging/logger.ts` redacta `password`, `passwordHash`, `refreshToken`, `accessToken`, `authorization`, `cookie`, `cardNumber`, `cvv` (con variantes `*.campo` para objetos anidados) antes de escribir el log.
- **Webhooks**: tanto `payments.service.ts` (`processWebhook`) como `billing.service.ts` (`processWebhook`) verifican la firma HMAC (`adapter.verifyWebhookSignature`) **antes** de tocar cualquier estado de negocio (`Payment`, `Subscription`, `SubscriptionInvoice`). Si la firma es inválida, se deja un registro de auditoría en `PaymentWebhookEvent` con `signatureValid: false` pero se lanza `BadRequestException` sin actualizar ningún registro de negocio. Idempotencia confirmada por el `@@unique([provider, eventId])` en `PaymentWebhookEvent` (schema.prisma línea ~468) — un evento ya procesado (`processedAt` seteado) devuelve `{ok: true, duplicate: true}` sin reprocesar.
- **RBAC**: `RbacModule` (`common/guards/rbac.module.ts`) registra `JwtAuthGuard` y `RolesGuard` como `APP_GUARD` globales (confirmado que `RbacModule` está importado en `app.module.ts`), en ese orden. `RolesGuard` es explícitamente **opt-in**: si un endpoint no tiene `@Roles()`, cualquier usuario autenticado pasa (no es opt-out ni default-público). Se revisaron varios controllers de riesgo (`users.controller.ts`, `branches.controller.ts`, `pos.controller.ts` con `@Roles()` a nivel de clase) y todos restringen correctamente las operaciones sensibles a roles `Owner`/`Admin`/`Cashier` según corresponda. Los únicos endpoints `@Public()` encontrados son: health checks, `auth/register|login|refresh|logout`, los dos webhooks de pago/billing (protegidos por HMAC, no por JWT — es su naturaleza), y `track/:id` (tracking de delivery por UUID no adivinable, que además redacta explícitamente teléfono/ubicación del repartidor si el estado no es rastreable o está offline — verificado en `DeliveryService.getPublicTracking`).

### Simplificaciones conocidas y deliberadas (no son bugs)

- No hay cola de jobs (BullMQ) — el trabajo en background corre de forma síncrona en el mismo request. `REDIS_URL` está declarado en el schema de env pero no se usa en ningún lado del código actual (confirmado por grep) más allá de la variable y un comentario sobre Fase 8+.
- No hay ubicación de repartidor en vivo respaldada por Redis — se escribe directo a Postgres (`DriverLocation`).
- Proveedor de pago de clientes y DLocal (SaaS billing) corren en modo mock/sandbox (`mock-payment.adapter.ts`, `mock-dlocal.adapter.ts`) — cualquier proveedor real (Bancard, MercadoPago, Stripe, DLocal real) todavía no está implementado, solo el adapter simulado con firma HMAC real para poder probar el flujo completo.
- Los avisos push caen a modo sandbox (loguean el aviso) si `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` no están configurados — confirmado en `push/push.adapter.ts`.
- No hay cron para downgrade de suscripción en la fecha de renovación — se aplica inmediatamente en `changePlan()` si el uso actual ya cabe en el plan nuevo (documentado explícitamente en `billing.service.ts` y en el comentario del campo `pendingPlanId` en `schema.prisma`, pendiente de un cron `subscription-billing` de Fase 8).

### Hallazgo real — a resolver antes de producción

- **`MOCK_PROVIDER_SECRET` y `DLOCAL_WEBHOOK_SECRET` tienen defaults inseguros sin guard de arranque** (`config/env.ts`): `.default('dev-mock-provider-secret-change-me')` y `.default('dev-dlocal-webhook-secret-change-me')`. A diferencia de `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (que son obligatorios y sin default, y abortan el boot si faltan), estas dos variables satisfacen el schema de Zod igual si no se configuran, y el proceso arranca con normalidad. Si se despliega a producción sin fijarlas explícitamente, la verificación de firma HMAC de los webhooks de pago/billing quedaría usando un secreto público y conocido (visible en este mismo repo) — cualquiera podría forjar un webhook `PAYMENT_APPROVED`/`SUBSCRIPTION_APPROVED` válido. **Recomendación**: antes de ir a producción, o (a) quitar el `.default(...)` de ambas variables para que sean obligatorias como los JWT secrets, o (b) agregar una validación de arranque que aborte si `NODE_ENV === 'production'` y el valor configurado coincide con el default conocido.
- No se encontraron gaps de tenant-scoping ni de RBAC en lo revisado (ver "Sólido" arriba). La revisión de RBAC fue puntual sobre controllers de alto riesgo (usuarios, sucursales, caja/POS) — no se auditó exhaustivamente cada endpoint de cada controller del monorepo; se recomienda una pasada final endpoint por endpoint antes de producción si el tiempo lo permite.
