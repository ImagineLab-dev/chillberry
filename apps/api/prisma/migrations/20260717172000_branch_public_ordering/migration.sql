-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "accepts_delivery" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "accepts_pickup" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "delivery_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "public_ordering_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "public_slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "branches_public_slug_key" ON "branches"("public_slug");

