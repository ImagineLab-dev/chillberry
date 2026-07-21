-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "created_by_id" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelled_by_id" UUID;
