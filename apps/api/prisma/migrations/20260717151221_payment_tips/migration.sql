-- AlterEnum
ALTER TYPE "CashMovementType" ADD VALUE 'TIP';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "tip_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
