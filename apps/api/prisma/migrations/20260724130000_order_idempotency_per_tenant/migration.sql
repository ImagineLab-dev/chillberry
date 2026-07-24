-- La idempotencia de pedido pasa a ser POR TENANT (no global): dos tenants pueden
-- reusar la misma clave sin chocar (el dedup y el catch P2002 son tenant-scoped).
-- Un índice único global provocaba un 500 en una colisión cross-tenant (el catch
-- tenant-scoped no encontraba el "ganador").
DROP INDEX "orders_idempotency_key_key";
CREATE UNIQUE INDEX "orders_tenant_id_idempotency_key_key" ON "orders"("tenant_id", "idempotency_key");
