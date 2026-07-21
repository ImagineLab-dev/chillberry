-- AlterTable
ALTER TABLE "menu_items" ADD COLUMN     "is_combo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "combo_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "combo_menu_item_id" UUID NOT NULL,
    "component_menu_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "combo_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "combo_components_tenant_id_idx" ON "combo_components"("tenant_id");

-- CreateIndex
CREATE INDEX "combo_components_combo_menu_item_id_idx" ON "combo_components"("combo_menu_item_id");

-- AddForeignKey
ALTER TABLE "combo_components" ADD CONSTRAINT "combo_components_combo_menu_item_id_fkey" FOREIGN KEY ("combo_menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_components" ADD CONSTRAINT "combo_components_component_menu_item_id_fkey" FOREIGN KEY ("component_menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

