-- Caché de la ruta calculada para cada entrega.
--
-- Por qué se cachea y no se pide en cada actualización: el repartidor manda su
-- posición cada 20 segundos, así que una entrega de media hora son ~90 pings.
-- Pedir la ruta en cada uno agotaría cualquier plan de ruteo en un día — y esto
-- es multi-tenant, con todos los restaurantes compartiendo la misma cuota.
--
-- La ruta casi no cambia mientras el repartidor la sigue: lo único que se mueve
-- es su punto sobre ella. Así que se calcula una vez, se guarda acá, y sólo se
-- recalcula si pasó tiempo o si el repartidor se desvió de verdad. Eso baja el
-- consumo de ~90 consultas por entrega a 1 o 2.

ALTER TABLE "deliveries"
  -- Geometría de la ruta: arreglo de pares [lat, lng] listo para dibujar.
  ADD COLUMN "route_geometry"   JSONB,
  ADD COLUMN "route_distance_m" INTEGER,
  ADD COLUMN "route_duration_s" INTEGER,
  -- Desde dónde se calculó. Sirve para medir cuánto se alejó el repartidor y
  -- decidir si hay que rehacerla.
  ADD COLUMN "route_from_lat"   DECIMAL(9,6),
  ADD COLUMN "route_from_lng"   DECIMAL(9,6),
  ADD COLUMN "route_updated_at" TIMESTAMPTZ;
