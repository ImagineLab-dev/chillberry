-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('HOT_KITCHEN', 'DRINKS', 'DESSERTS', 'GRILL');

-- CreateEnum
CREATE TYPE "KitchenTaskStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'READY', 'DELIVERED');

-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "station_id" UUID;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "kitchen_task_id" UUID;

-- CreateTable
CREATE TABLE "kitchen_stations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "StationType" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kitchen_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "status" "KitchenTaskStatus" NOT NULL DEFAULT 'NEW',
    "taken_by_id" UUID,
    "started_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kitchen_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kitchen_stations_tenant_id_idx" ON "kitchen_stations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "kitchen_stations_branch_id_type_key" ON "kitchen_stations"("branch_id", "type");

-- CreateIndex
CREATE INDEX "kitchen_tasks_tenant_id_idx" ON "kitchen_tasks"("tenant_id");

-- CreateIndex
CREATE INDEX "kitchen_tasks_station_id_status_idx" ON "kitchen_tasks"("station_id", "status");

-- CreateIndex
CREATE INDEX "kitchen_tasks_order_id_idx" ON "kitchen_tasks"("order_id");

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tasks" ADD CONSTRAINT "kitchen_tasks_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kitchen_tasks" ADD CONSTRAINT "kitchen_tasks_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_kitchen_task_id_fkey" FOREIGN KEY ("kitchen_task_id") REFERENCES "kitchen_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
