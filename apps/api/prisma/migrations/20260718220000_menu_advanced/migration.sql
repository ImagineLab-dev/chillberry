-- Menú avanzado: precio por canal (delivery), reordenamiento y "86" (agotado).
ALTER TABLE "menu_items" ADD COLUMN "delivery_price" DECIMAL(10,2);
ALTER TABLE "menu_items" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "menu_items" ADD COLUMN "sold_out" BOOLEAN NOT NULL DEFAULT false;
