-- "Linktree" de la sucursal: página de botones opcionales en el link público
-- (`/r/:slug`). JSON flexible con { enabled, headline, buttons[] }; NULL = el
-- link muestra la carta directo (comportamiento por defecto, sin ruptura).
ALTER TABLE "branches" ADD COLUMN "public_hub" JSONB;
