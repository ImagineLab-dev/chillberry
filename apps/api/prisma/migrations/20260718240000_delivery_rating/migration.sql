-- Calificación del cliente al repartidor desde el link de tracking.
ALTER TABLE "deliveries" ADD COLUMN "rating" INTEGER;
ALTER TABLE "deliveries" ADD COLUMN "rating_comment" TEXT;
