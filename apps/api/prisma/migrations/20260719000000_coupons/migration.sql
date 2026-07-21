-- Cupones de descuento reales (código validado) + su libro mayor de canjes.
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

CREATE TABLE "coupons" (
  "id"               UUID NOT NULL,
  "tenant_id"        UUID NOT NULL,
  "code"             TEXT NOT NULL,
  "description"      TEXT,
  "discount_type"    "CouponDiscountType" NOT NULL,
  "value"            DECIMAL(10,2) NOT NULL,
  "min_order_amount" DECIMAL(10,2),
  "max_uses"         INTEGER,
  "used_count"       INTEGER NOT NULL DEFAULT 0,
  "expires_at"       TIMESTAMP(3),
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "created_by_id"    UUID,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "coupons_tenant_id_code_key" ON "coupons"("tenant_id", "code");
CREATE INDEX "coupons_tenant_id_idx" ON "coupons"("tenant_id");

CREATE TABLE "coupon_redemptions" (
  "id"             UUID NOT NULL,
  "tenant_id"      UUID NOT NULL,
  "coupon_id"      UUID NOT NULL,
  "order_id"       UUID NOT NULL,
  "amount"         DECIMAL(10,2) NOT NULL,
  "customer_phone" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coupon_redemptions_tenant_id_idx" ON "coupon_redemptions"("tenant_id");
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "coupon_redemptions"("coupon_id");

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id")
  REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
