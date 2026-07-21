-- Token propio para el link de seguimiento del cliente.
--
-- Hasta ahora el link era `/track/<id-del-delivery>`: la MISMA clave que ven el
-- staff y el repartidor. Como el repartidor conoce el id de sus entregas y es
-- él quien dispara el estado "entregado", podía calificarse 5/5 a sí mismo
-- antes que el cliente. Eso le subía el promedio con el que el sistema reparte
-- los pedidos, y dejaba al cliente sin poder calificar (es una sola vez).
--
-- Con un token aparte, el link sólo lo tiene quien hizo el pedido.

-- 1) Se crea nullable para poder rellenar lo existente.
ALTER TABLE "deliveries" ADD COLUMN "tracking_token" TEXT;

-- 2) Relleno: 32 caracteres hex por fila. `gen_random_uuid()` viene de fábrica
--    en Postgres 13+, así que no hace falta ninguna extensión.
UPDATE "deliveries"
   SET "tracking_token" = replace(gen_random_uuid()::text, '-', '')
 WHERE "tracking_token" IS NULL;

-- 3) Recién ahora se puede exigir. NOT NULL + UNIQUE: sin el índice único, dos
--    entregas podrían compartir token y el link de una mostraría la otra.
ALTER TABLE "deliveries" ALTER COLUMN "tracking_token" SET NOT NULL;
CREATE UNIQUE INDEX "deliveries_tracking_token_key" ON "deliveries"("tracking_token");
