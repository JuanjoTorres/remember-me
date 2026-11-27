-- Free gifts are now kept three months from their publication instead of a year (owner's decision,
-- 2026-11-27). Gifts published before this runs follow the same rule; paid gifts never expire.
UPDATE "gifts" SET "expires_at" = COALESCE("published_at", CURRENT_TIMESTAMP) + INTERVAL '3 months'
WHERE "is_premium" = false AND "status" = 'PUBLISHED';
