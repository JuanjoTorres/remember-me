# Checkout (`apps/web/src/features/checkout`)

Read this before touching what opens the upgrade sheet, the sheet itself, the custom link field, the redirect
to Stripe, or the page the creator returns to after paying.

Stripe is never loaded in the browser. The web asks the API for a Checkout URL and sends the browser there.
There is no Stripe package in `apps/web/package.json`; do not add one.

## Upgrade triggers (`apps/web/src/features/checkout/upgrade-triggers.ts`)

- `CreatorIntent` is something the creator is about to do: `ADD_CARD` (with `cardType`), `PICK_REVEAL`
  (with `template`), `REMOVE_WATERMARK`, `DOWNLOAD_QR_SVG`.
- `UpgradeReason` is why the sheet opens: any `PremiumCapability` from
  `packages/shared-types/src/plans.ts`, plus `WATERMARK`, which exists only in the web.
- `upgradeReasonFor(gift, intent)` returns a reason or `null`. A premium gift always gets `null`. For a
  draft, `ADD_CARD` and `PICK_REVEAL` always get `null`: a draft is never stopped while it is built. For a
  published free gift it uses `checkAddCard` and `checkRevealTemplate` from shared-types, the same rules
  the API enforces.

Where each reason is raised today:

| Reason            | Raised by                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRO_FEATURES`    | Server `PREMIUM_REQUIRED` answering "Publish and get QR" on the preview, for a free gift with PRO features                                                          |
| `MAX_CARDS`       | Published free gift: `attempt` with `ADD_CARD` in `GiftEditor`; server `PREMIUM_REQUIRED` (also the fallback)                                                       |
| `CARD_TYPE`       | Published free gift: `attempt` with `ADD_CARD` for a type the plan lacks                                                                                            |
| `REVEAL_TEMPLATE` | Published free gift: `attempt` with `PICK_REVEAL` in `RevealSection`                                                                                                |
| `WATERMARK`       | `openUpgrade('WATERMARK')`: the upgrade link on the preview of a free gift, and the "keep it forever" button of a published free gift (editor and published screen) |
| `QR_FORMAT`       | `SharePanel` when the format is not in `gift.capabilities.qrFormats`, or the server refuses the download                                                            |
| `AUDIO_UPLOAD`    | `useUpload` in `MediaInputs.tsx` when the upload answers `PREMIUM_REQUIRED` (published free gift)                                                                   |
| `CUSTOM_SLUG`     | Nothing in the web raises it today; it can only arrive in a server `PREMIUM_REQUIRED`                                                                               |

The `REMOVE_WATERMARK` and `DOWNLOAD_QR_SVG` intents are defined and unit-tested but no component calls
`attempt` with them today.

The server has the last word: any `PREMIUM_REQUIRED` answer to a mutation opens the same sheet.

Add a trigger: add the intent (and the reason, if new) to `upgrade-triggers.ts`, add
`checkout.reason.<REASON>` to both message files (the sheet builds the key from the reason, and message
keys are typed from the English file), call `editor.attempt` from the editor, and cover it in
`apps/web/src/features/checkout/upgrade-triggers.test.ts` and
`apps/web/src/features/gift-creator/components/GiftEditor.test.tsx`.

## `PremiumUpgradeSheet` (`apps/web/src/features/checkout/PremiumUpgradeSheet.tsx`)

- Props: `reason` (`null` keeps it closed), `onClose`, `gift`, `withGrant`, `cancelPath` (where Stripe
  sends a creator who gives up; defaults to the editor) and `redirect` (defaults to
  `window.location.assign`; tests replace it).
- Content: the reason text; for `PRO_FEATURES` the PRO features the gift uses (`gift.proFeatures`, message
  keys `proFeature.*`); the feature list (`FEATURES`, message keys `feature*`), which starts with
  `featureForever`: a paid gift never expires, with a hint that free gifts are deleted after
  `FREE_GIFT_TTL_MONTHS`; the custom link extra; errors; and the pay button with the total.
- The reason text receives `max` from `PLAN_CAPABILITIES.FREE.maxCards` and `brand` from `BRAND_NAME`.
- It is rendered by `GiftEditor` (above the card sheet in the stack, so a refused card keeps its form open
  underneath), by `PreviewScreen` and by `PublishedScreen`.

## Where prices come from

`getPrices` calls `GET /payments/prices`. The sheet loads it with `useQuery` (key `['prices']`, enabled only
while open, `staleTime` set in the component). Amounts are in the smallest currency unit and are formatted
with `formatPrice` (`apps/web/src/features/shared/format.ts`) in the UI locale. The total is the premium
amount plus the custom link amount when ticked, shown in the premium price's currency. Until prices load the
button is disabled and shows the loading label; a failed load shows `pricesError`. No amount is written in
the web code or in messages.

## Custom link (`apps/web/src/features/checkout/CustomSlugField.tsx`)

- Props: `host` (taken from `gift.publicUrl`), `initialName`, and `onChange(name, state)`, called with the
  name alone ("ana-luis").
- The creator chooses only the name. The code in front is drawn by the API when the link is given to the
  gift, so the field never sends or shows one: the address is previewed with `····` where the code will
  be, and a hint says it appears on payment.
- `toSlugInput` keeps the name in slug form using `slugify`.
- `SlugState`: `empty`, `invalid` (fails `CustomNameSchema`: too short, too long or reserved), `valid`.
  Validation is local; the field makes no request.
- The live preview (`data-testid="slug-preview"`) shows host, the placeholder, `/for/` and the name.
- In the sheet, the field starts from the recipient's name. Payment is blocked unless the state is
  `valid`; `customSlug` in the checkout request is the name.
- The same field is reused by `PendingSlug` in
  `apps/web/src/features/gift-creator/components/SharePanel.tsx` when the name paid for could not be used; there
  the button needs `valid` and calls `PUT /gifts/:id/slug` with the name; a failure shows
  `pendingSlugError`.

## Paying

`pay()` in the sheet calls `createCheckoutSession`
inside `withGrant` (`POST /payments/checkout-session`) with `giftId`, `includeCustomSlug`, `customSlug`,
`successUrl` (the gift's success page on the current origin) and `cancelUrl` (`cancelPath`, or the editor); then
`redirect(session.checkoutUrl)`. `CONFLICT` shows the "already premium" message, anything else the generic
payment error. The request type is `CheckoutSessionRequest` in `packages/shared-types/src/payments.ts`.

## Return page

- Route: `/create/[giftId]/success`, screen in
  `apps/web/src/app/(main)/create/[giftId]/success/SuccessScreen.tsx`.
- `useGiftPaymentStatus(loadGift, options)`
  (`apps/web/src/features/checkout/useGiftPaymentStatus.ts`) polls `loadGift` until the gift's plan is
  `PREMIUM`. States: `waiting`, `delayed` (still polling), `confirmed` (final), `failed` (after three
  failed loads in a row; polling stops). Interval and delay threshold are the defaults of `intervalMs` and
  `delayedAfterMs`.
- `loadGift` in `SuccessScreen` returns the gift; while it is not premium, on the first poll and then every
  `CONFIRM_EVERY_POLLS` polls it also calls `confirmPayment` (`POST /payments/confirm`), which makes the API
  ask Stripe directly. This covers a late or lost webhook.
- `PaymentSuccess` (`apps/web/src/features/checkout/PaymentSuccess.tsx`) renders the three screens. On
  `confirmed` it fires confetti (skipped with reduced motion) and renders its children with the gift:
  `SuccessScreen` passes `SharePanel`, with a `withGrant` that reloads the gift for a fresh grant.
- A cancelled checkout returns to `cancelPath` (the preview or the published screen), or to the editor;
  nothing special happens there.
- Paying is what publishes a gift with PRO features: once confirmed, this page shows the final QR code
  and the creator never goes back through the editor.

## Decisions

- 2026-11-24: one payment, asked for when publishing, with the custom link as an optional extra in the same
  checkout. The sheet highlights that a paid gift never expires.
- 2026-11-24: a custom link always carries an ending of at least 4 characters, random by default.
- 2026-11-27 (replaces the line above): the code goes in front of the name and the API draws it when the
  link is applied; the creator only types the name and nothing is checked with the server beforehand. See `.claude/skills/backend/references/gifts.md`.

## Change checklist

- Code: `upgrade-triggers.ts`, `PremiumUpgradeSheet.tsx`, `CustomSlugField.tsx`, `PaymentSuccess.tsx`,
  `useGiftPaymentStatus.ts`, `apps/web/src/features/checkout/api.ts`. Nothing here may import
  `gift-creator`.
- Tests: `apps/web/src/features/checkout/PremiumUpgradeSheet.test.tsx`,
  `apps/web/src/features/checkout/upgrade-triggers.test.ts`,
  `apps/web/src/features/checkout/useGiftPaymentStatus.test.ts`, and `apps/web/e2e/premium-flow.spec.ts`
  (it also asserts that no payment method list is sent and that a forged webhook changes nothing).
- Strings: `checkout` namespace in both message files. No amounts, no limits.
- New Stripe call or price: `apps/web/e2e/fake-stripe.mjs` must answer it.
- References: this file; `.claude/skills/frontend/references/gift-creator.md` if the editor calls a new
  intent; `.claude/skills/backend/references/endpoints.md` and
  `.claude/skills/backend/references/contracts.md` for any payment or slug contract change.
