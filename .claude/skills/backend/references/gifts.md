# Gifts module

Read this before changing gift lifecycle, cards, publishing, slugs, deletion, or how a payment is applied.

All rules live in `apps/api/src/modules/gifts/gifts.service.ts` unless another file is named.

## Files

| File                                                         | Role                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `apps/api/src/modules/gifts/gifts.controller.ts`             | Editor endpoints (edit token)                              |
| `apps/api/src/modules/gifts/public-gifts.controller.ts`      | Recipient read by slug, no credentials                     |
| `apps/api/src/modules/gifts/gifts.service.ts`                | Every rule below                                           |
| `apps/api/src/modules/gifts/gift.mapper.ts`                  | Rows to `GiftEditorView` and `PublicGift`; `publicUrlOf`   |
| `apps/api/src/modules/gifts/edit-token.ts`                   | Token generation, hashing, constant-time comparison        |
| `apps/api/src/modules/gifts/slug-generator.ts`               | `generateSlug`, `generateCustomLink`                       |
| `apps/api/src/modules/gifts/link-guess-guard.ts`             | `LinkGuessGuard`: stops links being found by trying them   |
| `apps/api/src/modules/gifts/media-url-policy.ts`             | `MediaUrlPolicy`: which media URLs a gift may reference    |
| `apps/api/src/modules/gifts/payment-succeeded.subscriber.ts` | Subscribes to `payment.succeeded` and calls `applyPayment` |
| `apps/api/src/modules/gifts/gift-lifecycle.service.ts`       | `deleteExpired` and `sendAnniversaryEmails`                |
| `apps/api/src/modules/gifts/gift-lifecycle.cron.ts`          | The two daily schedules; no logic                          |
| `apps/api/src/modules/gifts/anniversary-email.ts`            | Subject, HTML and text of the anniversary email (en, es)   |

## Lifecycle

- `create` makes a `DRAFT`, FREE gift with a generated slug and an expiry (see "Expiry"), and returns the
  edit token once. No account.
- Status is `DRAFT` or `PUBLISHED`. There is no way back to draft and no unpublish.
- `isPremium` flips to true only in `applyPayment`. It never flips back.
- Every editor response is a `GiftEditorView` built by `view`, which also issues a fresh gift grant with
  the current id, slug, plan and published flag. Other modules see changes only through a new grant.

## Edit token

`generateEditToken` creates a random token; only its SHA-256 hash is stored (`gifts.edit_token_hash`).
`authorize` loads the gift, answers `NOT_FOUND` if it does not exist, then `UNAUTHORIZED` if the token is
missing or does not match (`editTokenMatches`, constant time). Every editor method calls it first. The
token cannot be rotated or recovered.

## Slugs

- Every link starts with a random code (`randomCode`: an alphabet without vowels or look-alike
  characters, drawn without bias, always with a digit). A code is never a word and never the name of a
  page of the site, and nothing about the gift can be worked out from it. The stored `slug` is the path of
  the link without its leading slash.
- Generated link: the code alone, `GIFT_CODE_LENGTH` characters ("x9k2bd7m", `kardoo.me/x9k2bd7m`). The
  link is the only secret of a gift, so this code is long on purpose. A gift gets it in `create`
  (`generateSlug`) and keeps it when it is published: it does not carry the recipient's name.
- Custom link, a paid extra: a code of `CUSTOM_CODE_LENGTH` characters, then the name the creator
  chose ("7k2m/for/ana-luis", `kardoo.me/7k2m/for/ana-luis`). The creator, the checkout and
  `PUT /gifts/:giftId/slug` only ever send the name (`CustomNameSchema`: a `SlugSchema` name that is not
  reserved). The code is drawn by the API when the link is given to the gift (`generateCustomLink` in
  `freeCustomLink`, until `slugIsFree`): nobody picks a code, so nobody picks an easy one. The same name
  can exist behind another code, so a name is never "taken" and there is nothing to check beforehand.
- `freeGeneratedSlug` is the only way a generated link is assigned (`create`): it draws until
  `slugIsFree` accepts the candidate, so a new gift never gets a link that is another gift's alias.
  Without it the printed QR code of that other gift would open the new one.
- `withSlugRetry` reruns a write that hit a unique violation on the slug, up to `SLUG_ATTEMPTS` times.
- A custom link is applied in `applyPayment` (bought as an order bump; `customSlug` in the order and in
  the event is the name), or with `changeSlug`, which is only allowed while `customSlugPending` is true
  (otherwise `PREMIUM_REQUIRED` with `CUSTOM_SLUG`); `changeSlug` reads the flag under the row lock, so
  two requests sent at once give one link, not two. Both set `slugIsCustom` and clear
  `customSlugPending`. `customSlugPending` is only set when a paid name cannot be used, which the
  checkout's validation normally rules out.
- `slugIsFree`: no gift has the slug and no other gift has it as an alias.
- Aliases (`keepOldLink`): when a published gift changes its link, the old one is stored in
  `gift_slug_aliases` so printed QR codes keep working. Going back to a former link removes that alias.
  `getPublic` looks up the slug, then the aliases.
- The public lookup has one route per shape (`public-gifts.controller.ts`): `GET /public/gifts/:code` and
  `GET /public/gifts/:code/for/:name`.

## Guessing links (`LinkGuessGuard`)

Whoever has a link can open the gift, so links must not be found by trying addresses. One budget per
client IP, over `LINK_GUESS_WINDOW_MS`, answering `RATE_LIMITED` with `details.retryAfterSeconds` once
used up:

- The public lookup: an address that is not even the shape of a link (`GiftLinkSchema`: a mistyped
  page, a crawler asking for a file) is answered `NOT_FOUND` without looking anything up and without
  counting. Every other answer that is `NOT_FOUND` (unknown link, draft, expired gift) counts
  as a miss. After `LINK_LOOKUP_MISS_LIMIT` misses every lookup of that client is refused until the window
  ends, also for links that exist: a refusal must not reveal anything. Links that exist never count, so a
  QR code can be opened any number of times.

No endpoint tells whether a link exists (the availability check and its budget were removed on
2026-11-27, when the API started to draw the code of custom links).

The counters are `AttemptLimiter` (`apps/api/src/shared/http/attempt-limiter.ts`): in memory, per API
instance, like the request throttler; when its table is full it drops the clients that are not blocked
and keeps the blocked ones. The client is the request IP (`@Ip()`) for IPv4 and the /64 network for IPv6
(`clientOf`: one subscriber owns a whole network and could otherwise change address for every attempt), which depends on
`TRUST_PROXY_HOPS`; the web forwards the visitor's address when it loads a gift on the server. A new
endpoint that tells whether a link exists must go through this guard.

## Cards

- Payload shape per type is validated by `CardInputSchema` at the controller and again by `CardSchema` on
  every read (`toCards`).
- `addCard` runs under the gift lock: `checkAddCard` (card type and `maxCards` of the plan) only when the
  plan applies (see "Plan limits and the paywall"), then the `MAX_CARDS_HARD_LIMIT` ceiling (`CONFLICT`).
  New cards go last.
- `updateCard` replaces the payload; the type of a card cannot change.
- `reorderCards` needs the full list of the gift's card ids, each exactly once; positions become the list
  indexes. The mapper returns cards sorted by position, then creation time, renumbered from 0.
- `removeCard` refuses to remove the last card of a published gift (`GIFT_INCOMPLETE`).
- Plan limits are checked only when adding. Nothing is removed or blocked retroactively.
- Every card write first refuses a locked gift (see "Locking after delivery").

## Reveal and gift fields

`update` accepts partial changes and runs under the gift lock. In order: a locked gift is refused; a
published gift refuses a different `recipientName`; a reveal template is checked with
`checkRevealTemplate` when the plan applies; a published gift cannot have its headline set to empty
(`GIFT_INCOMPLETE`).

## Plan limits and the paywall

- `planApplies` is true only for a `PUBLISHED` gift. A draft is not limited by its plan: any number of
  cards (up to the hard ceiling), every card type and every reveal template, also on a FREE gift. The
  media module follows the same rule for audio through the `published` claim of the grant.
- The paywall is `publish`. `proFeaturesOf` (shared-types) lists the paid features the content uses. A FREE
  gift that uses any is refused with `PREMIUM_REQUIRED`, details
  `{ capability: 'PRO_FEATURES', proFeatures }`. `GiftEditorView.proFeatures` carries the same list, so the
  editor can show it before publishing.
- Paying is what publishes such a gift: `applyPayment` publishes a ready draft.
- Once published, a FREE gift is held to the FREE plan on every change, as before.

## Publishing

`missingToPublish` is the single definition of "ready": at least one card (`CARDS`) and a non-blank
reveal headline (`REVEAL_HEADLINE`). `publish` checks it under the lock and answers `GIFT_INCOMPLETE` with
`details.missing`; it is a no-op for an already published gift (a double tap keeps the same link); then
comes the paywall above. A FREE gift without paid features is published free. `publishData` sets
`status`, `publishedAt` and `expiresAt`; the link stays the one the gift already had.
The public view carries `watermark` from the plan.

## Locking after delivery

A delivered gift must not be reused for someone else.

- From publication, `recipientName` cannot change: `GIFT_LOCKED` with `details.scope = 'RECIPIENT_NAME'`.
  Sending the same name again is not a change.
- `editableUntil` (shared-types) is `publishedAt` plus `EDIT_GRACE_HOURS`, or `lockedAt` if that is
  earlier. `isLocked` in `apps/api/src/modules/gifts/gift.mapper.ts` is true once that moment has passed.
- What ends at that moment is the edit link, not an editor that is already open
  (`GiftsService.canEdit`). Every `GiftEditorView` carries a grant with the claim `editing`; the editor
  sends the grant of its last answer back in `x-edit-session` (`EDIT_SESSION_HEADER`). After the window,
  a request may edit only if it presents a valid grant of this gift with `editing: true`. Such a grant
  is issued while the gift is editable, or to a request that already holds one: an editing session that
  was open in time goes on, renewed by every answer, and ends when its grant runs out
  (`GRANT_TTL_SECONDS` without a request). The browser keeps the grant only in memory: reloading the page
  after the window ends the session, because the first request of the new page carries no grant. Opening the link after the window gets `locked: true` and a
  grant with `editing: false`, which starts no session.
- A request that may not edit is refused by `update`, `addCard`, `updateCard`, `removeCard` and
  `reorderCards` with `GIFT_LOCKED`, `details.scope = 'GIFT'` (`assertEditable`).
- `lockedAt` closes the window early and ends every open session (`isLockedByHand`). Nothing in the
  application sets it today; it exists for support.
- Uploads are not covered: `media` accepts a file for any valid grant. The `editing` claim is there for
  it to use.
- Still allowed on a locked gift: reading, `publish` (no-op), `remove`, `applyPayment`, and `changeSlug`
  for a paid link that is pending.
- The editor view carries `publishedAt`, `editableUntil` and `locked`. `locked` is about the request that
  asked: `false` for an editing session that is still going on after the window.

## Expiry

`gifts.expires_at` is when the gift and its files are deleted; `null` means never.

| State              | `expiresAt`                                                | Set in         |
| ------------------ | ---------------------------------------------------------- | -------------- |
| Draft, never paid  | creation plus `DRAFT_TTL_DAYS` (`draftExpiry`)             | `create`       |
| Published, FREE    | publication plus `FREE_GIFT_TTL_MONTHS` (`freeGiftExpiry`) | `publishData`  |
| Paid, draft or not | `null`                                                     | `applyPayment` |

- `getPublic` answers `NOT_FOUND` for a gift past its expiry, even before the clean-up has run.
- `GiftLifecycleService.deleteExpired` deletes every gift with `expiresAt <= now`, one transaction per
  gift (`deleteIfExpired`): it locks the gift row, checks the expiry again, publishes `gift.deleted` (media
  removes the files, payments forgets the buyer's email) and deletes the row. The lock is what keeps a
  payment arriving at that moment from ending with a kept gift whose files are gone: `applyPayment` either
  ran before (the gift no longer expires and is left alone) or waits and finds no gift (`payment.unapplied`,
  refund due). A gift that fails is logged, skipped for the rest of the run and retried on the next one.
- The periods are constants of `packages/shared-types/src/lifecycle.ts`. Never write them elsewhere.

## Anniversary email (switched off: technical debt)

Owner's decision, 2026-11-27: the feature is off for now. `gift-lifecycle.cron.ts` does not schedule it,
so no email is ever sent. The code and its tests stay: `GiftLifecycleService.sendAnniversaryEmails`,
`anniversary-email.ts`, `apps/api/src/shared/mail`, the columns `customer_email` and
`anniversary_email_sent_at`, and `customerEmail` in `payment.succeeded` (still stored for paid gifts).

How it works when called: gifts that are premium, published at least `ANNIVERSARY_YEARS` ago, with a
`customerEmail` and no `anniversaryEmailSentAt`. Each gift is claimed first (an `updateMany` on
`anniversaryEmailSentAt IS NULL`), then the email is sent through `Mailer` with an idempotency key; a
failed send releases the claim. When `Mailer.delivers` is false (`MAIL_DRIVER=log`) it does nothing. The
email is written in the gift's language, links to the gift and has a button to `/create`.

To solve before scheduling it again (found in review, 2026-11-27):

- One run takes the 200 oldest due gifts and a failed send goes back to the head of the queue: 200
  addresses the provider always rejects would stop every later email. Needs a limit of attempts or a
  record of permanent failures.
- The claim is made before the send: if the process dies in between, that email is never sent.
- The email signs with the host of `WEB_ORIGIN`, so it does not say the brand name outside production.
- `customer_email` is kept after its only use. Clear it once the email is sent, or say so in the privacy
  page. While the feature is off the address is stored without being used.
- `ResendMailer` has never been run against the real service, and no test proves that a job is
  registered with the scheduler.
- The text of the email has not been reviewed by the owner.

## Schedules

`gift-lifecycle.cron.ts` (`@nestjs/schedule`, enabled by `ScheduleModule.forRoot()` in
`apps/api/src/app.module.ts`): `deleteExpired` daily at 03:15 UTC. Every API instance runs it unless
`SCHEDULED_JOBS=off` (the integration tests, which call the service directly); it is safe to run
concurrently. A failed run is logged and does not stop the process. The anniversary email has no schedule
(see above).

## Applying a payment (`applyPayment`)

Called by the subscriber with `orderId`, `giftId`, `customSlug`, `customerEmail`. In one transaction
under the gift lock:

- Gift missing: nothing is written and `payment.unapplied` is published (reason `GIFT_NOT_FOUND`) so
  payments can flag a refund.
- `orderId` already in `gifts.applied_order_ids`: nothing happens. This is what makes the handler
  idempotent for repeated and out-of-order deliveries. It must stay the first check after the lock.
- Otherwise: set `isPremium`, clear `expiresAt`, store `customerEmail` when the event carries one (an
  event without it never erases a stored address), append the order id, and
  - a custom name the gift's link already has: nothing changes;
  - a valid custom name (`CustomNameSchema`): draw a free link for it, keep the old link as alias,
    apply it;
  - a name that is not valid: keep the upgrade and set `customSlugPending` so the creator chooses
    another one for free;
  - if the gift is a draft that is ready, publish it in the same write (`publishData`). An unfinished
    draft is upgraded but stays a draft.

## Row lock

`lock` takes a row lock on the gift (`SELECT … FOR UPDATE`) inside a transaction and re-reads it with its
cards. Use it for any write that depends on what was read: it is what stops two requests from passing the
card limit, a double publish from changing the link, and a payment racing a publish. `updateCard` and
`reorderCards` do not lock.

## Media URL policy

`MediaUrlPolicy` accepts a media URL only if it is `<MEDIA_PUBLIC_URL>/gifts/<giftId>/<file>` with a flat
file name and an allowed extension (WebP for images, M4A or MP3 for audio). The URL alone proves the file
belongs to the gift, so `gifts` never asks `media`. It is applied in `addCard`, `updateCard` and `update`
(reveal image). It does not check that the file exists.

## Deletion

`remove` publishes `gift.deleted` first and deletes the gift only afterwards. Subscribers: media deletes
the files, payments erases the buyer's email from its orders. With the memory driver a
failing subscriber (media cleanup) makes the request fail while the gift still exists, so the creator can
retry. Cards and aliases go with the gift (cascade). Payment orders are kept.

## Decisions

- 2026-11-24: editing a draft is never blocked by the plan; the single paywall is publication, with one
  payment. A gift without paid features is published free, with watermark.
- 2026-11-24: every link, generated or custom, ends with a code of at least 4 letters or digits.
- 2026-11-24 (replaces "generated ones use 4 random characters" of the same day): the owner's concern is that
  links could be found by trying combinations. Generated links end with 8 random characters; a custom
  link, a paid extra, keeps its minimum of 4; and trying links is throttled per client on the public
  lookup and on the availability check.
- 2026-11-24: publishing fixes the recipient's name at once; everything else can be corrected for 48 hours and
  is then locked for good. Deleting stays possible.
- 2026-11-24: drafts expire 7 days after creation, free gifts 1 year after publication, paid gifts never.
- 2026-11-24: the buyer of a paid gift gets one email a year after publication, inviting them to relive it and
  to create a new one. The address comes with the payment event; payments and gifts stay decoupled.
- 2026-11-27: what ends 48 hours after publication is the edit link. Whoever opened the editor before
  that and is still editing keeps saving; whoever opens the link later finds the gift locked. (Chosen by
  the implementation, not stated by the owner: the session ends after `GRANT_TTL_SECONDS` without a
  request, there is no absolute limit, and a reload of the page ends it. All three await the owner.)
- 2026-11-27: free gifts are kept 3 months from publication, not a year (replaces the figure of
  2026-11-24). Paid gifts never expire.
- 2026-11-27 (replaces the link format of 2026-11-24): the code goes in front. A generated link is the
  code alone; a custom link is a short code chosen by the system followed by `/for/` and the name the
  creator chose, so that what was paid for ends the address. Every code has a digit. The owner first
  proposed a code derived from the time of creation and settled on a random one, which cannot be worked
  out. Links in the old format stop working: there was no production yet.
- 2026-11-27: the code of a custom link is drawn by the API, never sent by a client. The creator sends
  only the name; `GET /gifts/check-slug`, its budget (`SLUG_CHECK_LIMIT`) and the error `SLUG_TAKEN` are
  gone, since any valid name can be had. The address is shown with the code still to come until the
  payment arrives.
- 2026-11-27: the anniversary email is switched off and recorded as technical debt (section above).
- 2026-11-27: there is no production yet, only staging. A deployment that deletes old staging gifts (the
  expiry backfill of `20261124210813_gift_lifecycle`) needs no precaution.
- 2026-11-24 (kept from the existing design, not what the request literally named): the edit token stays in the
  `x-edit-token` header and gifts are addressed by id (`DELETE /gifts/:giftId`), instead of a token in the
  URL path, which would end up in server logs and browser history.

## Change checklist

- Rule change: `apps/api/src/modules/gifts/gifts.service.ts` plus a test in `apps/api/test/gifts.test.ts`
  (payment application is also covered end to end in `apps/api/test/payments.test.ts`). Expiry and the
  anniversary email: `apps/api/src/modules/gifts/gift-lifecycle.service.ts` and
  `apps/api/test/gift-lifecycle.test.ts`.
- New write endpoint or method: call `assertEditable` unless the action must work on a delivered gift.
- New gift or card field: contract in `packages/shared-types/src/gifts.ts`, column in
  `apps/api/prisma/schema.prisma` with a migration, mapping in
  `apps/api/src/modules/gifts/gift.mapper.ts`, and the web editor and experience.
- New media field: add it to `MediaUrlPolicy`.
- New publish requirement: `missingToPublish` only; check `update` and `removeCard`, which protect
  published gifts from becoming incomplete.
- New fact other modules need: a new grant claim (`.claude/skills/backend/references/auth-and-security.md`).
- Update this file; `.claude/skills/backend/references/endpoints.md` if a route or error changed;
  `.claude/skills/backend/references/events.md` if event handling changed.
