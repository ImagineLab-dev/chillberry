-- Suscripciones a notificaciones push del navegador.
--
-- Reemplazan a WhatsApp como forma de avisarle a alguien que no está mirando la
-- pantalla. Sin esto, el comensal que escanea el QR, pide y guarda el teléfono
-- en el bolsillo no se entera de nada hasta que vuelve a abrir la página.
--
-- Se indexa por TELÉFONO y no por usuario porque el comensal no tiene cuenta:
-- es la única forma de identificarlo, y es además el dato con el que ya
-- trabajaban todas las notificaciones.
CREATE TABLE "push_subscriptions" (
  "id"         UUID PRIMARY KEY,
  "tenant_id"  UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- A quién le llega. Para el comensal es su teléfono; para el repartidor y el
  -- personal, el de su cuenta.
  "phone"      TEXT NOT NULL,
  -- Endpoint del navegador. Único: si la misma persona vuelve a suscribirse
  -- desde el mismo dispositivo, se actualiza en vez de duplicar el aviso.
  "endpoint"   TEXT NOT NULL,
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  -- Se llena sólo si quien se suscribe tiene cuenta (repartidor, personal).
  "user_id"    UUID REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Última vez que el navegador aceptó un envío. Sirve para limpiar las que
  -- quedaron muertas (el usuario desinstaló, revocó el permiso, cambió de
  -- equipo) sin tener que adivinar cuáles.
  "last_ok_at" TIMESTAMPTZ
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_tenant_phone_idx" ON "push_subscriptions"("tenant_id", "phone");
