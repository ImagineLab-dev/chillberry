-- CreateTable
CREATE TABLE "branch_hours" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "open_minute" INTEGER NOT NULL,
    "close_minute" INTEGER NOT NULL,

    CONSTRAINT "branch_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_closures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "branch_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_hours_tenant_id_idx" ON "branch_hours"("tenant_id");

-- CreateIndex
CREATE INDEX "branch_hours_branch_id_weekday_idx" ON "branch_hours"("branch_id", "weekday");

-- CreateIndex
CREATE INDEX "branch_closures_tenant_id_idx" ON "branch_closures"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_closures_branch_id_date_key" ON "branch_closures"("branch_id", "date");

-- AddForeignKey
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

