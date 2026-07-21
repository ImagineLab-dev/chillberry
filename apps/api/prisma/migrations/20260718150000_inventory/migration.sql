-- Inventario por insumos + recetas.

CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "stock_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "low_stock_at" DECIMAL(14,3),
    "cost_per_unit" DECIMAL(14,4),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ingredients_tenant_id_idx" ON "ingredients"("tenant_id");
CREATE UNIQUE INDEX "ingredients_branch_id_name_key" ON "ingredients"("branch_id", "name");

ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "recipe_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recipe_components_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recipe_components_tenant_id_idx" ON "recipe_components"("tenant_id");
CREATE INDEX "recipe_components_ingredient_id_idx" ON "recipe_components"("ingredient_id");
CREATE UNIQUE INDEX "recipe_components_menu_item_id_ingredient_id_key" ON "recipe_components"("menu_item_id", "ingredient_id");

ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_menu_item_id_fkey"
    FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_ingredient_id_fkey"
    FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
