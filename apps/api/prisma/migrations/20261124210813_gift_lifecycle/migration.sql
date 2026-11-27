-- AlterTable
ALTER TABLE "gifts" ADD COLUMN     "anniversary_email_sent_at" TIMESTAMP(3),
ADD COLUMN     "customer_email" TEXT,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "locked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "customer_email" TEXT;

-- CreateIndex
CREATE INDEX "gifts_expires_at_idx" ON "gifts"("expires_at");

-- Existing gifts get the expiry their plan now carries. A paid gift keeps NULL: it never expires.
-- Drafts that already exist get a full week from now, not from when they were started, so that
-- nobody loses a draft the day this is deployed.
UPDATE "gifts" SET "expires_at" = CURRENT_TIMESTAMP + INTERVAL '7 days'
WHERE "is_premium" = false AND "status" = 'DRAFT';

UPDATE "gifts" SET "expires_at" = COALESCE("published_at", CURRENT_TIMESTAMP) + INTERVAL '1 year'
WHERE "is_premium" = false AND "status" = 'PUBLISHED';
