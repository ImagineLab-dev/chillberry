-- Reportes de problema / sugerencias de función que los restaurantes (tenants)
-- le mandan al equipo de Chillberry. Se avisa por mail a soporte@ y se gestiona
-- desde el panel de super-admin. Distinto de `feedback` (opiniones de comensales).

CREATE TYPE "SupportRequestType" AS ENUM ('BUG', 'SUGGESTION');

CREATE TABLE "support_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "type" "SupportRequestType" NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_requests_handled_created_at_idx" ON "support_requests"("handled", "created_at");

ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
