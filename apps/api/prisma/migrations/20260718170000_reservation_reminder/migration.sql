-- Recordatorio de reservas: flag para no duplicar el aviso por WhatsApp.
ALTER TABLE "reservations" ADD COLUMN "reminder_sent" BOOLEAN NOT NULL DEFAULT false;
