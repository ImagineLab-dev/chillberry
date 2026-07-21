-- CreateEnum
CREATE TYPE "BillSplitMode" AS ENUM ('BY_PERSON', 'BY_ITEM');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bill_requested_at" TIMESTAMP(3),
ADD COLUMN     "cancel_reason" TEXT;

-- CreateTable
CREATE TABLE "table_transfer_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_table_id" UUID NOT NULL,
    "to_table_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_transfer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_merge_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "primary_table_id" UUID NOT NULL,
    "merged_table_ids" JSONB NOT NULL,
    "result_order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_merge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_splits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "mode" "BillSplitMode" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_splits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "table_transfer_logs_tenant_id_idx" ON "table_transfer_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "table_merge_logs_tenant_id_idx" ON "table_merge_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "bill_splits_tenant_id_idx" ON "bill_splits"("tenant_id");

-- CreateIndex
CREATE INDEX "bill_splits_order_id_idx" ON "bill_splits"("order_id");

-- AddForeignKey
ALTER TABLE "bill_splits" ADD CONSTRAINT "bill_splits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
