-- Códigos de un solo uso para alta de cuenta y recuperación de contraseña.
--
-- No lleva `tenant_id` a propósito: en el alta el tenant todavía no existe (se
-- crea recién cuando el código se valida), así que esta tabla queda fuera del
-- scoping por tenant. El `email` es el identificador.
CREATE TYPE "VerificationPurpose" AS ENUM ('SIGNUP', 'PASSWORD_RESET');

CREATE TABLE "verification_codes" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "purpose" "VerificationPurpose" NOT NULL,
  -- Se guarda el HASH, nunca el código: quien lea la base no puede validar
  -- cuentas ajenas.
  "code_hash" TEXT NOT NULL,
  -- Datos del alta pendiente (sólo SIGNUP): nombre del local, país y el hash de
  -- la contraseña. El Tenant nace recién al verificar.
  "payload" JSONB,
  -- Tope de intentos: 6 dígitos son 1.000.000 de combinaciones y sin límite se
  -- rompen con un script en minutos.
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verification_codes_email_purpose_idx" ON "verification_codes" ("email", "purpose");
-- Para la limpieza periódica de códigos vencidos.
CREATE INDEX "verification_codes_expires_at_idx" ON "verification_codes" ("expires_at");
