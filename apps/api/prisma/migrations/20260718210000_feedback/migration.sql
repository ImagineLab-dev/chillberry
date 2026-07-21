-- Encuesta de calificación post-visita: una fila por pedido cobrado que el cron
-- envía al cliente unas horas después; se completa desde el link público.
CREATE TABLE "feedbacks" (
  "id"             UUID NOT NULL,
  "tenant_id"      UUID NOT NULL,
  "order_id"       UUID NOT NULL,
  "branch_id"      UUID NOT NULL,
  "waiter_id"      UUID,
  "token"          TEXT NOT NULL,
  "customer_phone" TEXT,
  "rating"         INTEGER,
  "comment"        TEXT,
  "sent_at"        TIMESTAMP(3),
  "completed_at"   TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feedbacks_order_id_key" ON "feedbacks"("order_id");
CREATE UNIQUE INDEX "feedbacks_token_key" ON "feedbacks"("token");
CREATE INDEX "feedbacks_tenant_id_idx" ON "feedbacks"("tenant_id");
CREATE INDEX "feedbacks_branch_id_idx" ON "feedbacks"("branch_id");

ALTER TABLE "feedbacks"
  ADD CONSTRAINT "feedbacks_order_id_fkey" FOREIGN KEY ("order_id")
  REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedbacks"
  ADD CONSTRAINT "feedbacks_branch_id_fkey" FOREIGN KEY ("branch_id")
  REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
