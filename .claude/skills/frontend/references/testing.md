# Testing the web app

Read this before writing or fixing a unit, component or browser test in `apps/web`.

Rule: never weaken, skip or delete a test to make it pass. If a test fails, the code or the test's
expectation of new intended behaviour is wrong; fix that and say which.

## Commands

| Command                  | Runs                                                                           |
| ------------------------ | ------------------------------------------------------------------------------ |
| `pnpm --filter web test` | Vitest for the web only (no Docker needed)                                     |
| `pnpm test`              | Every package through Turborepo (the API tests need Docker)                    |
| `pnpm build`             | Required before e2e; needs `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL`        |
| `pnpm test:e2e`          | `scripts/e2e.sh`: Playwright inside the official Playwright Docker image       |
| `pnpm test:e2e <args>`   | Extra arguments are passed to `playwright test` (for example a spec file name) |

## Vitest (`apps/web/vitest.config.ts`)

- Environment `jsdom`, React plugin, alias `@` to `apps/web/src`.
- Picks up `*.test.ts` and `*.test.tsx` under `apps/web/src` and `apps/web/test`. Tests sit next to the code
  they cover; tests about the app as a whole go in `apps/web/test`.
- `apps/web/test/setup.ts` loads the jest-dom matchers, unmounts after each test, and raises the Testing
  Library wait (`asyncUtilTimeout`) above its 1 s default. `apps/web/vitest.config.ts` raises `testTimeout`
  above the 5 s default. Both were raised on 2026-11-24 after CI on `main` failed twice in a row on two
  different tests that were only slow (a `findByRole` and the ESLint-based boundary test). Do not lower
  them, and do not answer a timeout by raising them further without finding out what is slow.
- The config sets `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` so `apps/web/src/config/env.ts` can be
  imported.

Helpers in `apps/web/test/render.tsx`:

- `renderApp(ui)`: renders inside `NextIntlClientProvider` (English messages) and a fresh `QueryClient`.
  Use it for anything from the editor or checkout.
- `giftView(overrides)`: a valid `GiftEditorView`; `capabilities` follow the plan through
  `PLAN_CAPABILITIES`.
- `photoCards(count)`: that many `PHOTO_TEXT` cards.

Recipient components are rendered with plain `render` from Testing Library and a hand-written `labels`
object: they must work without providers, and the test proves it.

## Test files

| File                                                                | Covers                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web/src/config/env.test.ts`                                   | Env parsing: trailing slash, missing public URL, non-http internal URL                               |
| `apps/web/src/i18n/locale.test.ts`                                  | `resolveLocale`: cookie, header weights, fallback                                                    |
| `apps/web/test/messages.test.ts`                                    | Same keys and same placeholders in English and Spanish                                               |
| `apps/web/test/recipient-boundaries.test.ts`                        | The lint rule: recipient files cannot import editor, checkout, Stripe (runs in the node environment) |
| `apps/web/src/features/shared/ui/Sheet.test.tsx`                    | Focus in and back, Tab trap, only the top sheet reacts to Escape                                     |
| `apps/web/src/features/gift-creator/components/GiftEditor.test.tsx` | Every upgrade trigger, server refusal, publish rules, premium gift, QR after publishing              |
| `apps/web/src/features/gift-creator/components/SavedInput.test.tsx` | Save on blur only when changed; typed text wins over a stale server value                            |
| `apps/web/src/features/gift-creator/card-form.test.ts`              | `toCardInput` against `CardInputSchema`; `fitWithin`                                                 |
| `apps/web/src/features/gift-creator/storage.test.ts`                | Edit link round trip, saved gifts, held vs stored token, storage unavailable                         |
| `apps/web/src/features/checkout/upgrade-triggers.test.ts`           | `upgradeReasonFor` for every intent and plan                                                         |
| `apps/web/src/features/checkout/PremiumUpgradeSheet.test.tsx`       | Reasons, prices from the API, custom link preview and blocking, checkout request, failure            |
| `apps/web/src/features/checkout/useGiftPaymentStatus.test.ts`       | Polling to confirmed, delayed, repeated failure, stop on unmount (fake timers)                       |
| `apps/web/src/features/gift-experience/stories.test.ts`             | Step order, navigation bounds, trivia gate, restart, `mediaAhead`                                    |
| `apps/web/src/features/gift-experience/usePreloadMedia.test.ts`     | Next media is requested early and never twice                                                        |
| `apps/web/src/features/gift-experience/GiftExperience.test.tsx`     | Whole recipient flow per reveal template, watermark, confetti, reduced motion, replay                |
| `apps/web/src/features/gift-reveal/scratch.test.ts`                 | `clearedRatio`                                                                                       |

## Writing a component test

- Model for the editor side: `apps/web/src/features/checkout/PremiumUpgradeSheet.test.tsx`. Model for the
  recipient side: `apps/web/src/features/gift-experience/GiftExperience.test.tsx`.
- Mock at the feature's `api.ts` with `vi.mock`, never `fetch`. `GiftEditor.test.tsx` builds the object that
  `giftApi` returns by hand: add new `giftApi` functions there.
- Mock `next/navigation` when the component uses the router; mock `canvas-confetti` when it celebrates.
- Find elements by role and accessible name, using the English message text. `data-testid` exists only where
  there is no role or text to use (`slug-preview`, `scratch-surface`, `watermark`, `reveal-content`).
- Drive it with `userEvent`. Sheets and story steps animate, so wait with `findBy…` for what appears next.
- Side effects are injected where they would leave the page: `PremiumUpgradeSheet` takes `redirect`.
- Pure logic (`stories.ts`, `scratch.ts`, `upgrade-triggers.ts`, `storage.ts`, `toCardInput`) is tested
  without rendering. Put new logic in a pure function first.
- Time-based hooks use fake timers and pass short intervals through the hook's options.

## Playwright (`apps/web/playwright.config.ts`)

- One project, `mobile-chrome` (Pixel 7 profile), browser locale `en-US`, one worker, no retries, clipboard
  permissions granted, traces kept on failure.
- It starts three servers itself and does not reuse running ones: the Stripe stand-in
  (`apps/web/e2e/fake-stripe.mjs`), the built API (the compiled entry point of `apps/api`, with test credentials
  and `STRIPE_API_BASE_URL` pointing at the stand-in), and the built web app from the standalone output.
  So `pnpm build` must have run for both apps, and the ports in the config must be free.
- `scripts/e2e.sh` starts Postgres and storage with Docker Compose, applies migrations, and runs Playwright
  in the Playwright container on the compose network, passing `E2E_DATABASE_URL` and `E2E_STORAGE_URL`.
- `WEBHOOK_SECRET` is exported from the config so helpers can sign webhooks.

Files in `apps/web/e2e`:

| File                   | Holds                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gift-flow.spec.ts`    | Free flow: create, upload a photo, free limits open the sheet, publish, QR download, edit link in a clean browser, no access without it, the recipient in another locale, the recipient bundle check, the Spanish 404. |
| `premium-flow.spec.ts` | Upgrade with a custom link, waiting page, forged and duplicated webhooks, both QR formats, premium editor, trivia, scratching by touch and by mouse; and a payment confirmed with no webhook at all.                   |
| `helpers.ts`           | `startGift`, `addTextCard`, `fillSurprise`, `lastCheckoutSession`, `deliverPaidWebhook`, `recordScripts`.                                                                                                              |
| `fixtures.ts`          | `PHOTO`: a small valid PNG buffer for uploads.                                                                                                                                                                         |
| `fake-stripe.mjs`      | Answers the Stripe calls the API makes; Checkout "completes" by returning the success URL. Test hooks under `/__sessions` list sessions and mark one paid.                                                             |

## Writing an e2e flow

- Start from `startGift` and the other helpers; add a helper when two specs need the same steps.
- Use a fresh browser context for a second person (recipient, another device) instead of reusing the page.
- Payment: the stand-in redirects straight to the success page. Then either deliver the webhook with
  `deliverPaidWebhook(session, amount)` or mark the session paid through the stand-in to exercise
  `POST /payments/confirm`.
- A new Stripe endpoint used by the API needs a route in `fake-stripe.mjs`; new prices go in its `PRICES`
  map and in the API `env` of the Playwright config.
- Use unique values where the database is shared between runs (the premium spec adds a timestamp to its
  custom link).
- Anything loaded by the recipient page: keep or extend the marker list in the bundle check.

## Decisions

None recorded yet.

## Change checklist

- New behaviour: a test next to the code; a changed user flow: the matching e2e spec.
- New test helper or fixture: add it to the lists above.
- Changed message text: update the lookups in tests and specs, not the other way round.
- New env var for the web: the `env` block in `apps/web/vitest.config.ts` and, if the server needs it, in
  `apps/web/playwright.config.ts`.
- Changed how tests are run (scripts, images, ports): this file and the `ops` skill.
