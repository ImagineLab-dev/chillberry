-- Idempotencia de creación de pedido: deduplica el doble-submit (dos POST /orders
-- con la misma clave devuelven el MISMO pedido en vez de duplicar la comanda).
ALTER TABLE "orders" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- Contador de intentos fallidos del código de entrega: tras varios se bloquea el
-- `deliver`, para que un repartidor no pueda fuerza-brutear los 6 dígitos.
ALTER TABLE "deliveries" ADD COLUMN "deliver_attempts" INTEGER NOT NULL DEFAULT 0;
