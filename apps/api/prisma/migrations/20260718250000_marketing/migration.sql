-- Marketing: historial de campañas enviadas a segmentos de clientes.
CREATE TABLE "marketing_campaigns" (
  "id"              UUID NOT NULL,
  "tenant_id"       UUID NOT NULL,
  "segment"         TEXT NOT NULL,
  "message"         TEXT NOT NULL,
  "recipient_count" INTEGER NOT NULL,
  "created_by_id"   UUID,
  "sent_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "marketing_campaigns_tenant_id_idx" ON "marketing_campaigns"("tenant_id");
