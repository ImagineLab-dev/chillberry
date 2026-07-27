-- El comensal, al pedir la cuenta desde el QR, puede adjuntar una nota
-- (propina elegida, "dividir en N", medio de pago). Es informativa para el
-- staff que cobra; no mueve plata.
ALTER TABLE "orders" ADD COLUMN "bill_request_note" TEXT;
