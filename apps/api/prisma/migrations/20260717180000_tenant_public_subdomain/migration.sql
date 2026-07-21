-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "public_subdomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_public_subdomain_key" ON "tenants"("public_subdomain");

