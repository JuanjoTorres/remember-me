-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('PHOTO_TEXT', 'AUDIO_NOTE', 'TRIVIA');

-- CreateEnum
CREATE TYPE "RevealTemplate" AS ENUM ('BASIC', 'SCRATCH_CARD', 'TICKET', 'GIFT_BOX');

-- CreateTable
CREATE TABLE "gifts" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "slug_is_custom" BOOLEAN NOT NULL DEFAULT false,
    "custom_slug_pending" BOOLEAN NOT NULL DEFAULT false,
    "edit_token_hash" TEXT NOT NULL,
    "status" "GiftStatus" NOT NULL DEFAULT 'DRAFT',
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "recipient_name" TEXT NOT NULL DEFAULT '',
    "sender_name" TEXT NOT NULL DEFAULT '',
    "reveal_template" "RevealTemplate" NOT NULL DEFAULT 'BASIC',
    "reveal_headline" TEXT NOT NULL DEFAULT '',
    "reveal_message" TEXT NOT NULL DEFAULT '',
    "reveal_detail" TEXT NOT NULL DEFAULT '',
    "reveal_image_url" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" UUID NOT NULL,
    "gift_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "CardType" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gifts_slug_key" ON "gifts"("slug");

-- CreateIndex
CREATE INDEX "gift_cards_gift_id_position_idx" ON "gift_cards"("gift_id", "position");

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_gift_id_fkey" FOREIGN KEY ("gift_id") REFERENCES "gifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
