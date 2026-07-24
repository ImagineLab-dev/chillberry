-- Vencimiento de las invitaciones al equipo (7 días desde el envío).
-- Nullable y sin backfill a propósito: las invitaciones emitidas ANTES de este
-- cambio quedan sin fecha y se tratan como sin vencimiento (no se rompe ningún
-- link ya mandado); las nuevas nacen con vencimiento siempre.
ALTER TABLE "users" ADD COLUMN "invitation_expires_at" TIMESTAMP(3);
