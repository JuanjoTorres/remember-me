# Phase 5: Gift experience and reveal (2026-11-23)

## Done

- `/for/[slug]`: its own root layout (full screen, `100dvh`, dark), rendered on the server through
  `INTERNAL_API_URL`. No client providers, no i18n runtime: texts are resolved on the server in the language
  the gift was written in. Not indexed, no referrer.
- Stories: cover, one card per tap (left third goes back), progress segments, keyboard arrows.
  Photo & text, voice note with a large play button, trivia that holds the way until answered correctly.
- `usePreloadMedia`: while one step is on screen, the photos and audio of the next two (and the reveal photo)
  are fetched in the background.
- Four reveals with confetti: envelope (free), scratch card (canvas, finger or mouse, opens at 45 %
  scratched), boarding pass (drag or tap the stub), gift box (three taps). Each premium reveal has a
  "Show me the surprise" shortcut for people who cannot do the gesture; confetti respects reduced motion.
- Free gifts end with "Created with remember.me"; premium gifts do not.
- Friendly not-found page for unknown or unpublished links.
- Tests: 65 in the web app. Two Playwright flows on a mobile viewport:
  - free: create → publish → recipient opens the link, media is preloaded during the cover, envelope reveal,
    watermark, and the downloaded JavaScript contains no editor, checkout or Stripe code;
  - paid: upgrade with a custom link → return page waits → forged webhook rejected → signed webhook confirms
    → QR in PNG and SVG → trivia and scratch card → recipient scratches with a finger, then with a mouse.

## What changed from the plan (and why)

- **The paid flow is now covered end to end**, with a local stand-in for the Stripe API
  (`apps/web/e2e/fake-stripe.mjs`). The API accepts `STRIPE_API_BASE_URL` for this; the setting is refused
  in staging and production.
- **The gift box opens with taps**, not with a shake gesture: device motion needs a permission prompt on iOS.
- **"Bundle check" is done in the browser test** (inspecting the scripts the recipient page downloads)
  instead of a build-time script.

## Pending (not blocking)

- A recipient who opens an old link of a gift is shown the gift but not redirected to the current link.
- The experience is not available offline; media is only preloaded two steps ahead.

## What I need from you

- Nothing.

## Proposal for the next phase

- Phase 6 as planned: hardening, compose with the app services, deploy workflow, final check.
