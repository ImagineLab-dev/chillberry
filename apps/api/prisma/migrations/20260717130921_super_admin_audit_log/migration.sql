-- CreateTable
CREATE TABLE "super_admin_audit_logs" (
    "id" UUID NOT NULL,
    "super_admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_tenant_id" UUID NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "super_admin_audit_logs_created_at_idx" ON "super_admin_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "super_admin_audit_logs_target_tenant_id_idx" ON "super_admin_audit_logs"("target_tenant_id");
