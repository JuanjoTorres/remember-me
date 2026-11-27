# Media and QR modules

Read this before changing uploads, media processing, object storage, or QR code generation.

## Media: files

| File                                              | Role                                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `apps/api/src/modules/media/media.controller.ts`  | Two upload routes, grant guard, per-route size limit            |
| `apps/api/src/modules/media/media.service.ts`     | `upload`, `deleteAllOf`, the `gift.deleted` subscription        |
| `apps/api/src/modules/media/media-processing.ts`  | `processImage`, `processAudio` and the content sniffers         |
| `apps/api/src/modules/media/object-storage.ts`    | `ObjectStorage` abstraction (`put`, `delete`)                   |
| `apps/api/src/modules/media/s3-object-storage.ts` | The only implementation: S3 API (Cloudflare R2, S3Mock locally) |
| `apps/api/src/modules/media/media.module.ts`      | Binds `ObjectStorage` to `S3ObjectStorage`                      |

## Upload flow (`MediaService.upload`)

1. `GiftGrantGuard` runs before the body is read. The gift id and plan come from the grant claims; the
   module never reads the `gifts` tables.
2. The file interceptor accepts one file in field `file`, kept in memory, and enforces
   `MEDIA_LIMITS.imageMaxBytes` or `MEDIA_LIMITS.audioMaxBytes` (shared with the web so it can check before
   sending). Over the limit is `PAYLOAD_TOO_LARGE`; no file is `VALIDATION_ERROR`.
3. Audio of a published gift (the grant's `published` claim) needs a plan whose `cardTypes` include
   `AUDIO_NOTE`, read from `PLAN_CAPABILITIES`; otherwise `PREMIUM_REQUIRED` with capability
   `AUDIO_UPLOAD`. A draft may upload audio on any plan: the plan is settled when the gift is published.
   Images are allowed on every plan.
4. Processing (below). Failure is `UNSUPPORTED_MEDIA`.
5. A `media_assets` row is reserved inside a transaction that holds a per-gift advisory lock and checks
   the ceiling `MAX_ASSETS_PER_GIFT` (`CONFLICT` when reached). Parallel uploads cannot pass it.
6. The object is written to storage. If that fails the row is deleted and the error propagates, so no row
   exists without an object.
7. The response URL is `MEDIA_PUBLIC_URL` plus the storage key.

## Processing

- Images (`processImage`): the format is detected by sharp from the content, not from the name or declared
  type. Accepted inputs are in `ACCEPTED_IMAGE_FORMATS`. `MAX_INPUT_PIXELS` guards against decompression
  bombs. The image is rotated upright, resized to fit `MEDIA_LIMITS.imageMaxEdge` without enlarging, and
  always re-encoded as WebP. Metadata (EXIF, location) is dropped by the re-encode.
- Audio (`processAudio`): stored unchanged. Accepted by content only: MP3 needs an optional ID3v2 tag
  followed by two consecutive valid MPEG Layer III frames (`isMp3`); M4A needs an ISO media file with a
  sound track and no video track, and not one of `NON_AUDIO_BRANDS` (`isAudioOnlyMp4`).

## Storage

- Key layout: "gifts/", the gift id, a random UUID, and the extension from processing (webp, mp3 or m4a).
  This layout is a contract with the gifts module: `MediaUrlPolicy` in
  `apps/api/src/modules/gifts/media-url-policy.ts` accepts a URL by its prefix and extension. Changing the
  layout or adding an extension means changing both sides.
- `S3ObjectStorage` builds its client from `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, the two key variables
  and `S3_FORCE_PATH_STYLE`. Optional checksums are disabled because R2 does not implement them. Objects
  are written with an immutable, long-lived cache header: names are unique and never rewritten.
- The bucket must be publicly readable under `MEDIA_PUBLIC_URL`; the API never serves or signs media.
- `media_assets` tracks every stored object (`storageKey` unique, `giftId` indexed, no relation to
  `gifts`).

## Storage ceiling

`MAX_ASSETS_PER_GIFT` counts rows of the gift, and rows are only removed when the whole gift is deleted.
Replacing a photo or deleting a card does not free a slot or delete the object.

## Cleanup on gift deletion

`MediaService` subscribes to `gift.deleted` as subscriber "media" and runs `deleteAllOf`: for each asset,
delete the object, then the row. It is idempotent and resumable: a failure half-way leaves the remaining
rows for the next delivery. With the memory driver the failure reaches `GiftsService.remove`, which then
keeps the gift (see `.claude/skills/backend/references/gifts.md`).

## QR

| File                                       | Role                                   |
| ------------------------------------------ | -------------------------------------- |
| `apps/api/src/modules/qr/qr.controller.ts` | `GET /qr`, grant guard, `format` query |
| `apps/api/src/modules/qr/qr.service.ts`    | `targetUrl`, `render`                  |

- Stateless: everything comes from the grant claims (`slug`, `plan`, `published`) and `WEB_ORIGIN`.
- The code encodes `WEB_ORIGIN` + "/" + slug (`QrService.targetUrl`); the slug is the path of the link.
  The file name replaces the slashes of a custom link with hyphens. The same URL is built
  independently by `publicUrlOf` in `apps/api/src/modules/gifts/gift.mapper.ts`; keep them equal.
- An unpublished gift gets `CONFLICT`: the link is only final after publication.
- Formats per plan come from `checkQrFormat` (`qrFormats` in `PLAN_CAPABILITIES`); a format the plan lacks
  is `PREMIUM_REQUIRED` with `QR_FORMAT`. PNG width is the plan's `qrPngSize`. SVG has no size.
- Error correction level and margin are the `options` constant in `render`.
- The response is a file download, never cached (`private, no-store`), because a grant can go stale.
- A QR downloaded before a custom link was applied still works: the old slug becomes an alias.

## Decisions

None recorded yet.

## Change checklist

- Limits: `MEDIA_LIMITS` in `packages/shared-types/src/media.ts` (the web reads them too);
  `MAX_ASSETS_PER_GIFT` in `apps/api/src/modules/media/media.service.ts`.
- New accepted format or extension: `apps/api/src/modules/media/media-processing.ts` and
  `apps/api/src/modules/gifts/media-url-policy.ts`, with tests on both sides.
- New storage backend: a class extending `ObjectStorage`, bound in
  `apps/api/src/modules/media/media.module.ts`.
- QR formats or sizes: `PLAN_CAPABILITIES` and `QrFormatSchema` in `packages/shared-types/src/plans.ts`,
  then `apps/api/src/modules/qr/qr.service.ts`.
- Tests: `apps/api/test/media-qr.test.ts` (uploads against a real S3 API, the ceiling under parallel
  uploads, deletion, QR decoding).
- Update this file, and `.claude/skills/backend/references/endpoints.md` if a route or error changed.
