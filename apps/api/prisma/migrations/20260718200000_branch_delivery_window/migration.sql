-- Ventana horaria específica de delivery por sucursal (minutos desde medianoche,
-- hora local del tenant). NULL = sin restricción propia de delivery.
ALTER TABLE "branches" ADD COLUMN "delivery_start_minute" INTEGER;
ALTER TABLE "branches" ADD COLUMN "delivery_end_minute" INTEGER;
