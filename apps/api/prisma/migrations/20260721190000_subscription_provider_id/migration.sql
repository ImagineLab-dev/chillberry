-- Id de la suscripción del lado del proveedor, en la suscripción y no en la
-- factura.
--
-- El webhook de cada cobro mensual trae el id de la SUSCRIPCIÓN. Buscarlo
-- contra `subscription_invoices.provider_payment_id` funcionaba sólo el primer
-- mes, porque hay una sola factura por suscripción: del segundo cobro en
-- adelante encontraba esa misma factura ya pagada, la volvía a marcar pagada y
-- fijaba `renewal_date` en el vencimiento original, que para entonces ya pasó.
-- Además nunca quedaba historial mensual de lo cobrado.
ALTER TABLE "subscriptions" ADD COLUMN "provider_subscription_id" TEXT;

CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key"
  ON "subscriptions"("provider_subscription_id");

-- Rellena las suscripciones que ya tenían una factura con su id de proveedor,
-- para que sus cobros siguientes se correlacionen bien.
UPDATE "subscriptions" s
   SET "provider_subscription_id" = i."provider_payment_id"
  FROM "subscription_invoices" i
 WHERE i."subscription_id" = s."id"
   AND i."provider_payment_id" IS NOT NULL
   AND s."provider_subscription_id" IS NULL;
