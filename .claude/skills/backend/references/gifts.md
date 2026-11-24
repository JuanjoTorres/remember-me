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
| `apps/api/src/modules/gifts/slug-generator.ts`               | `generateSlug`                                             |
| `apps/api/src/modules/gifts/media-url-policy.ts`             | `MediaUrlPolicy`: which media URLs a gift may reference    |
| `apps/api/src/modules/gifts/payment-succeeded.subscriber.ts` | Subscribes to `payment.succeeded` and calls `applyPayment` |

## Lifecycle

- `create` makes a `DRAFT`, FREE gift with a generated slug and returns the edit token once. No account.
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

- Generated slugs (`generateSlug`): slugified recipient name (or "gift" when empty) plus a random
  6-character code from an alphabet without vowels or look-alike characters, within `SLUG_MAX_LENGTH`.
- A draft starts with a "gift-…" slug. On first publication `publishData` replaces it with one built from
  the recipient name, unless `slugIsCustom` is true. After publication the link only changes to a custom
  one.
- `withSlugRetry` reruns a write that hit a unique violation on the slug, up to `SLUG_ATTEMPTS` times.
- Custom slug: bought as an order bump and applied in `applyPayment`, or chosen later with `changeSlug`,
  which is only allowed while `customSlugPending` is true (otherwise `PREMIUM_REQUIRED` with
  `CUSTOM_SLUG`). Both set `slugIsCustom` and clear `customSlugPending`.
- `slugIsFree`: no gift has the slug and no other gift has it as an alias.
- Aliases (`keepOldLink`): when a published gift changes its slug, the old one is stored in
  `gift_slug_aliases` so printed QR codes keep working. Going back to a former slug removes that alias.
  `getPublic` looks up the slug, then the aliases.
- `slugAvailability` answers `INVALID`, `RESERVED` or `TAKEN`; it is advisory. The real check happens
  under the lock when the slug is applied.

## Cards

- Payload shape per type is validated by `CardInputSchema` at the controller and again by `CardSchema` on
  every read (`toCards`).
- `addCard` runs under the gift lock: `checkAddCard` (card type and `maxCards` of the plan) then the
  `MAX_CARDS_HARD_LIMIT` ceiling (`CONFLICT`). New cards go last.
- `updateCard` replaces the payload; the type of a card cannot change.
- `reorderCards` needs the full list of the gift's card ids, each exactly once; positions become the list
  indexes. The mapper returns cards sorted by position, then creation time, renumbered from 0.
- `removeCard` refuses to remove the last card of a published gift (`GIFT_INCOMPLETE`).
- Plan limits are checked only when adding. Nothing is removed or blocked retroactively.

## Reveal and gift fields

`update` accepts partial changes. A reveal template is checked with `checkRevealTemplate`. A published
gift cannot have its headline set to empty (`GIFT_INCOMPLETE`), checked under the lock.

## Publishing

`missingToPublish` is the single definition of "ready": at least one card (`CARDS`) and a non-blank
reveal headline (`REVEAL_HEADLINE`). `publish` checks it under the lock, answers `GIFT_INCOMPLETE` with
`details.missing`, and is a no-op for an already published gift (a double tap keeps the same link). A
FREE gift can be published. The public view carries `watermark` from the plan.

## Applying a payment (`applyPayment`)

Called by the subscriber with `orderId`, `giftId`, `customSlug`. In one transaction under the gift lock:

- Gift missing: nothing is written and `payment.unapplied` is published (reason `GIFT_NOT_FOUND`) so
  payments can flag a refund.
- `orderId` already in `gifts.applied_order_ids`: nothing happens. This is what makes the handler
  idempotent for repeated and out-of-order deliveries. It must stay the first check after the lock.
- Otherwise: set `isPremium`, append the order id, and
  - custom slug equal to the current slug: just mark it custom;
  - custom slug valid (`CustomSlugSchema`) and free: keep the old link as alias, apply it;
  - custom slug invalid or taken: keep the upgrade and set `customSlugPending` so the creator picks
    another one for free;
  - if the gift is a draft that is ready, publish it in the same write (`publishData`). An unfinished
    draft is upgraded but stays a draft.

## Locking

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

`remove` publishes `gift.deleted` first and deletes the gift only afterwards. With the memory driver a
failing subscriber (media cleanup) makes the request fail while the gift still exists, so the creator can
retry. Cards and aliases go with the gift (cascade). Payment orders are kept.

## Decisions

None recorded yet.

## Change checklist

- Rule change: `apps/api/src/modules/gifts/gifts.service.ts` plus a test in `apps/api/test/gifts.test.ts`
  (payment application is also covered end to end in `apps/api/test/payments.test.ts`).
- New gift or card field: contract in `packages/shared-types/src/gifts.ts`, column in
  `apps/api/prisma/schema.prisma` with a migration, mapping in
  `apps/api/src/modules/gifts/gift.mapper.ts`, and the web editor and experience.
- New media field: add it to `MediaUrlPolicy`.
- New publish requirement: `missingToPublish` only; check `update` and `removeCard`, which protect
  published gifts from becoming incomplete.
- New fact other modules need: a new grant claim (`.claude/skills/backend/references/auth-and-security.md`).
- Update this file; `.claude/skills/backend/references/endpoints.md` if a route or error changed;
  `.claude/skills/backend/references/events.md` if event handling changed.
