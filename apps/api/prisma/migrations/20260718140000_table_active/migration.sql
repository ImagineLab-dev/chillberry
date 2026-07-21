-- Soft-delete de mesas: una mesa retirada se marca inactiva (no se muestra en
-- el mapa del mesero ni acepta pedidos por su QR). NOT NULL con default true →
-- todas las mesas existentes quedan activas.
ALTER TABLE "tables" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
