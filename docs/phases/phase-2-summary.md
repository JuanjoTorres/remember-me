# Phase 2: Media and QR (2026-11-23)

## Done

- `media` module: `POST /media/images` (JPEG/PNG/WebP in, WebP out, max 1600 px, upright, metadata
  stripped) and `POST /media/audio` (M4A/MP3 detected by content). Stored in S3-compatible storage under
  `gifts/<giftId>/<uuid>.<ext>`; rows in `media_assets` (no relation to `gifts`).
- Audio upload answers `PREMIUM_REQUIRED` (`AUDIO_UPLOAD`) for a free gift.
- `media` deletes a gift's files when it receives `GiftDeletedEvent`.
- `qr` module: `GET /qr?format=png|svg`. Free: 512 px PNG. Premium: 2048 px PNG and SVG. Only for
  published gifts, because the link is final from publication.
- Both modules authorize with the gift grant and never call `gifts`.
- Fixes from the review of phases 0-1:
  - Publishing and applying a payment now lock the gift: a double tap or a payment arriving during
    publication can no longer replace the link.
  - Applying a payment is idempotent per order (`gifts.paid_order_id`) and publishes a ready draft.
  - A published gift cannot lose its last card or its headline.
  - Text with NUL characters is rejected with 400 instead of failing in the database.
  - Redis driver: retries group creation, scans stale deliveries with a cursor, trims streams.
  - The example signing secret is refused in staging and production.
  - Test for the lint rule of the recipient path; dependency register completed.
- Tests: 67 in the API, including QR decode round-trip and real S3 API.

## What changed from the plan (and why)

- **S3Mock instead of MinIO** for local and test storage: the `minio/minio` image is no longer on Docker Hub.
- **Audio gating also at upload**, not only when creating the card, thanks to the plan in the grant.

## Pending (not blocking)

- Files uploaded but never used in a card stay in storage until the gift is deleted.
- A grant stays valid up to 30 minutes after its gift is deleted; an upload in that window leaves orphans.
- The Redis driver has no dead-letter queue: an event whose handler always fails is retried forever (and
  logged each time).
- The API image cannot run migrations yet; solved in Phase 6 with the compose setup.

## What I need from you

- Nothing.

## Proposal for the next phase

- Phase 3 as planned: payments.
