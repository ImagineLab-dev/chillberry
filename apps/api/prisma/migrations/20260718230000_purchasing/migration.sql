-- Compras: proveedores + órdenes de compra con recepción a stock.
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED');

CREATE TABLE "suppliers" (
  "id"           UUID NOT NULL,
  "tenant_id"    UUID NOT NULL,
  "name"         TEXT NOT NULL,
  "contact_name" TEXT,
  "phone"        TEXT,
  "email"        TEXT,
  "notes"        TEXT,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "suppliers_tenant_id_idx" ON "suppliers"("tenant_id");

CREATE TABLE "purchase_orders" (
  "id"            UUID NOT NULL,
  "tenant_id"     UUID NOT NULL,
  "branch_id"     UUID NOT NULL,
  "supplier_id"   UUID NOT NULL,
  "status"        "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"         TEXT,
  "total"         DECIMAL(12,2) NOT NULL DEFAULT 0,
  "created_by_id" UUID,
  "received_at"   TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_orders_tenant_id_idx" ON "purchase_orders"("tenant_id");
CREATE INDEX "purchase_orders_branch_id_status_idx" ON "purchase_orders"("branch_id", "status");

CREATE TABLE "purchase_order_items" (
  "id"                UUID NOT NULL,
  "tenant_id"         UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "ingredient_id"     UUID NOT NULL,
  "quantity"          DECIMAL(14,3) NOT NULL,
  "unit_cost"         DECIMAL(14,4) NOT NULL,
  CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_order_items_tenant_id_idx" ON "purchase_order_items"("tenant_id");
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
