# Phase 4: Gift creator and checkout UI (2026-11-23)

## Done

- `/create`: starts a gift on the first visit, or lists the gifts this device can edit.
- `/create/[giftId]`: mobile-first editor. Names, story (photo & text, voice note, trivia; edit, reorder,
  remove), surprise (template, headline, message, detail, photo), publish bar, delete.
- Photos are compressed in the browser (canvas, max 1600 px) before upload. Voice notes can be recorded
  where the browser can produce M4A, or picked as an M4A/MP3 file.
- Edit access without accounts: the token is kept on the device, and the "edit link"
  (`/create/<id>#token=…`) reopens the editor elsewhere. The token travels in the URL fragment, so it never
  reaches server logs, and is removed from the address bar after it is stored.
- `PremiumUpgradeSheet` (bottom drawer) opens on: fourth card, voice note, trivia, premium reveal,
  "Publish without watermark", SVG download, and whenever the API answers `PREMIUM_REQUIRED`. It shows the
  prices read from the API, the custom link order bump with live preview and availability, and redirects to
  Stripe Checkout.
- `/create/[giftId]/success`: polls until the webhook has upgraded the gift, then shows the final QR
  (PNG/SVG), the link and, if the paid custom link was taken, a field to choose another.
- Share panel after publishing: QR preview and download, public link, edit link.
- UI in English and Spanish, with a test that keeps both message files in sync.
- Tests: 44 in the web app (upgrade triggers, upgrade sheet, slug preview, payment polling, editor wiring,
  lint boundaries) and a Playwright smoke test on a mobile viewport: create, upload a photo, hit each free
  limit, publish free, download the QR, reopen through the edit link, no access without it.

## What changed from the plan (and why)

- **No client compression library:** the browser canvas does it, one dependency less.
- **Playwright runs in its official Docker image** (`pnpm test:e2e`): Chromium needs system libraries that
  are not installed on this machine and installing them needs root.
- **Local storage is not persistent:** S3Mock could not write to a mounted volume, so uploaded files are
  lost when the storage container is recreated. Fine for development.
- **This phase is reviewed together with Phase 5** (both are web UI).

## Pending (not blocking)

- The paid flow (Stripe redirect and success page) is covered by component and hook tests, not end to end:
  it needs Stripe test keys.
- With placeholder Stripe keys the upgrade sheet shows "couldn't load the price", as expected.
- Reordering uses up/down buttons, not drag and drop.

## What I need from you

- Stripe test keys and prices, to try the upgrade and the success page for real.

## Proposal for the next phase

- Phase 5 as planned: `/for/[slug]` stories and the four reveals.
