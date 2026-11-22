-- AlterTable
ALTER TABLE "gifts" ADD COLUMN     "applied_order_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "gift_slug_aliases" (
    "slug" TEXT NOT NULL,
    "gift_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_slug_aliases_pkey" PRIMARY KEY ("slug")
);

-- CreateIndex
CREATE INDEX "gift_slug_aliases_gift_id_idx" ON "gift_slug_aliases"("gift_id");

-- AddForeignKey
ALTER TABLE "gift_slug_aliases" ADD CONSTRAINT "gift_slug_aliases_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
