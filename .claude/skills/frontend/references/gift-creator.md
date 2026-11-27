# The editor (`gift-creator`)

Read this before touching anything the creator uses to build a gift: cards, fields, media, saving, the share
panel, or how the edit token is kept.

## Components (`apps/web/src/features/gift-creator/components`)

| Component       | File                | Does                                                                                                                                                                                                     |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CreateStart`   | `CreateStart.tsx`   | Entry at `/create`. No saved gifts: creates one at once (`createGift` with the UI locale) and navigates. Otherwise lists them plus a "new" button.                                                       |
| `EditorGate`    | `EditorGate.tsx`    | Resolves the edit token for a gift (fragment first, then storage) and renders its children with it, or the "no access" screen.                                                                           |
| `GiftEditor`    | `GiftEditor.tsx`    | The whole editor page: header with plan badge, sections 1 names, 2 story, 3 surprise, share panel, danger zone, sticky bar (PRO summary, preview button), both sheets.                                   |
| `DangerZone`    | `DangerZone.tsx`    | Irreversible deletion in two steps: ask, then type the confirmation word. Exports `isDeleteConfirmation`.                                                                                                |
| `CardList`      | `CardList.tsx`      | Cards in order with edit, move up/down (`reorderCards`) and remove.                                                                                                                                      |
| `CardSheet`     | `CardSheet.tsx`     | Bottom sheet with the form of one card (new or existing). Exports `CardFormState` and `toCardInput`.                                                                                                     |
| `ImagePicker`   | `MediaInputs.tsx`   | Picks a photo, compresses it, uploads it, shows it with change / remove.                                                                                                                                 |
| `AudioInput`    | `MediaInputs.tsx`   | Records a voice note or picks an audio file, uploads it, shows a player.                                                                                                                                 |
| `RevealSection` | `RevealSection.tsx` | Template picker (from `RevealTemplateSchema.options`) and the surprise fields: headline, message, detail, photo.                                                                                         |
| `SavedInput`    | `SavedInput.tsx`    | Text control with its own draft that saves on blur if the trimmed text changed, when the editor asks before leaving the page, and by itself when an answer leaves it showing a text that was never sent. |
| `SharePanel`    | `SharePanel.tsx`    | Public link, QR preview and downloads (published only), pending custom link, private edit link.                                                                                                          |

## `useGiftEditor` (`apps/web/src/features/gift-creator/useGiftEditor.ts`)

- Loads the gift with `useQuery`. Query key: `['gift', giftId, editToken]`. The token is in the key on
  purpose, so falling back from a refused link token to the stored one reloads.
- `giftApi(giftId, editToken, lastGrant)` sends the grant of the cached gift back with every editor call
  (`x-edit-session`). After the 48 hours the server only accepts changes from an editor that was opened in
  time and proves it this way; an editor opened later gets `gift.locked`.
- One `useMutation` runs every change. Its `scope` id is `gift-<giftId>`, so changes of one gift run one at
  a time and responses cannot arrive out of order. Every endpoint answers with the whole updated gift, which
  `onSuccess` writes into the query cache. There are no optimistic updates.
- `run(action)`: applies a change through `giftApi`. Resolves to the updated gift, or `null` when refused
  or failed (it never throws). Callers use the `null` to keep a form open.
- `attempt(intent, action)`: asks `upgradeReasonFor` first. If the plan does not allow the intent it opens
  the upgrade sheet and does not call `action`. On a draft it never stops adding a card or picking a
  reveal.
- `withGrant(call)`: runs a media, QR or payment call with `gift.grant` from the cache; on `UNAUTHORIZED`
  it reloads the gift once for a fresh grant and retries.
- Errors: `PREMIUM_REQUIRED` from the server opens the upgrade sheet with `details.capability`
  (falls back to `MAX_CARDS`); `GIFT_LOCKED` sets `lockedScope` (from `details.scope`) and reloads the
  gift, so the editor shows it as it now is; anything else sets `failed`. The sticky bar shows the
  matching message.
- `run(action, fromField)`: the optional second argument marks the change of a text field.
- `registerField(saveIfChanged)`: a `SavedInput` given `register={editor.registerField}` hands the editor a
  function that saves the field when it shows a text that is not the saved one. Every text field of the
  editor must pass it. The field is the only memory of what is unsaved: nothing is replayed from a list.
- `settled()`: tells whether the gift on the server is what the editor shows. It waits until no change is
  on its way (including one started during the wait) and until the editor has been rendered with the last
  answer (the answer reaches the query cache before the fields are rendered with it, so asking them
  earlier would compare against an old value). Then it asks every registered field to save what it shows
  if that is not saved, waits again, and repeats until no field has anything to save. This covers a field
  that still has the focus, a save that failed or was refused, and a text typed back while its save was on
  its way. It resolves to `true` only if all of that was saved. A control that leaves the page (the
  preview button) awaits it and stays on `false`: the next screen must never show or publish a gift
  without what the fields show. When a change failed it sets `failed`, so the save error stays visible.
- Also returns `api`, `gift`, `loadError`, `loading`, `saving`, `lockedScope`, `upgradeReason`,
  `openUpgrade`, `closeUpgrade`. The type `GiftEditor` is the hook's return type and is what child components receive.

## Edit token and edit link (`apps/web/src/features/gift-creator/storage.ts`)

- Saved gifts live in `localStorage` under the key in `KEY`, as `{ giftId, editToken, savedAt }`.
  Every read and write is wrapped: with storage blocked the editor still works in the tab from an in-memory
  map (`sessionTokens`).
- The edit link is built by `editLink`: the token travels in the URL fragment (`#token=`), which is never
  sent to a server. `tokenFromHash` reads it back.
- `EditorGate` takes a token from the fragment, removes it from the address bar, and only _holds_ it
  (`holdEditToken`). `GiftEditor` stores it (`saveGift`) once the API has returned the gift, and drops it
  (`dropHeldToken`) when the API refuses it and a stored token exists. A truncated link can therefore never
  overwrite a working token.
- Deleting a gift calls `forgetGift`. `EditorGate` and `CreateStart` read storage with
  `useSyncExternalStore`, so server render and first client render agree.

## Media

- Images: `compressImage` (`apps/web/src/features/gift-creator/compress-image.ts`) scales the longest edge
  down to `MEDIA_LIMITS.imageMaxEdge`, re-encodes as JPEG, and keeps the original file if the result is not
  smaller or the browser cannot decode it. `fitWithin` is the pure part. The server converts to WebP.
- Audio: recording is offered only when `canRecord()` is true (MediaRecorder supports `RECORDING_TYPE`).
  It stops by itself after `MAX_RECORDING_MS`. Files larger than `MEDIA_LIMITS.audioMaxBytes` are refused
  before upload. Closing the form while recording releases the microphone and discards the take.
- Both inputs upload through `useUpload` in `MediaInputs.tsx`: `uploadMedia` inside `withGrant`. It maps
  `PREMIUM_REQUIRED` to the upgrade sheet (`AUDIO_UPLOAD`), `UNSUPPORTED_MEDIA` and `PAYLOAD_TOO_LARGE` to
  their messages, anything else to a generic upload error.
- `onBusy` tells `CardSheet` that an upload or recording is running; its save button stays disabled until
  the count is back to zero.

## Saving behaviour

- Names and surprise fields: `SavedInput` saves on blur through `run((api) => api.update(...))`. While the
  field has focus, the creator's text wins over an older value coming back from the server.
- Reveal template and reveal photo save immediately on selection.
- A card is saved only with the sheet's button. The button is enabled when `CardInputSchema` accepts
  `toCardInput(type, form)`; `toCardInput` drops empty trivia answers and moves `correctIndex` with them.
- The editor does not publish. Its sticky bar has one button, "Preview and publish", enabled when the gift
  has a card and a headline (`missing` in `GiftEditor`); it navigates to the preview route
  (`.claude/skills/frontend/references/routes.md`).
- Delete: `DangerZone`. The second step needs the word `DELETE` or `BORRAR` typed (either one, any case,
  whatever the language of the page); then `api.remove()`, `forgetGift`, go home. A failure keeps the gift
  and shows a message. It stays available on a locked gift.

## Free editing and PRO marks

- Nothing is blocked while a gift is a draft. What the free plan does not include is only marked with the
  `PRO` badge (`creator.premiumBadge`): card types outside `gift.capabilities.cardTypes`, any add-card
  button once the gift has `PLAN_CAPABILITIES.FREE.maxCards` cards, and reveal templates outside
  `gift.capabilities.revealTemplates`. A premium gift shows no badge.
- The sticky bar of a free draft shows the PRO summary (`data-testid="pro-summary"`) when
  `gift.proFeatures` is not empty: the features by name (`checkout.proFeature.*`) and that they are paid
  once, on publishing. The list comes from the API; the web never computes it.
- A published free gift keeps the limits of its plan: there `attempt` and the server open the upgrade
  sheet as before.

## After publication

- The recipient's name input is disabled as soon as the gift is published.
- The heading text says until when corrections are possible (`gift.editableUntil`, formatted with
  `formatDateTime` from `apps/web/src/features/shared/format.ts`, which uses the time zone of the
  creator's device; next-intl's `useFormatter` would use the server's), or that the gift is delivered and read-only (`gift.locked`).
- When `gift.locked`, sections 1 to 3 sit in a disabled `fieldset`, which turns every control inside off.
  The share panel and the danger zone are outside it.
- A free gift shows until when it stays online (`gift.expiresAt`) and a button that opens the upgrade
  sheet; a free draft shows when it would be deleted. Dates and periods come from the gift and from
  `packages/shared-types/src/lifecycle.ts`, never from a message.

## Share panel

- When published: fetches the PNG QR through `withGrant` and `downloadQr` again whenever the slug or plan
  changes; shows the public URL with `displayUrl`; copy link; download PNG and SVG. A format missing from
  `gift.capabilities.qrFormats` opens the upgrade sheet (`QR_FORMAT`) instead of downloading.
- When `gift.customSlugPending` is true it shows `PendingSlug`: a `CustomSlugField` plus a button that calls
  `onChangeSlug`.
- Always shows the "keep your edit link" box, also on a draft.
- It is used three times: by `GiftEditor`, by
  `apps/web/src/app/(main)/create/[giftId]/published/PublishedScreen.tsx` and by
  `apps/web/src/app/(main)/create/[giftId]/success/SuccessScreen.tsx`. Keep its props free of the hook.

## Typical changes

| Change                | Touch                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New field on the gift | Contract in `packages/shared-types/src/gifts.ts`; a `Field` + `SavedInput` in `GiftEditor.tsx` or `RevealSection.tsx`; messages; `giftView` in `apps/web/test/render.tsx`.                                                                                                                                             |
| New field on a card   | Payload schema in shared-types; `CardFormState`, `initialState`, `toCardInput` and the form in `CardSheet.tsx`; the card component in `apps/web/src/features/gift-experience/cards`; `apps/web/src/features/gift-creator/card-form.test.ts`.                                                                           |
| New card type         | `CardTypeSchema` and `PLAN_CAPABILITIES` in `packages/shared-types/src/plans.ts`, payload in `gifts.ts`; then `CARD_TYPES` in `GiftEditor.tsx`, `summary` and `ICONS` in `CardList.tsx`, `CardSheet.tsx`, messages `creator.cardType.*` and `creator.cardTitle.*`, and the recipient side (gift-experience reference). |
| New editor section    | A `Section` in `GiftEditor.tsx` rendering a new component in the `components` folder that receives `gift` and `editor`.                                                                                                                                                                                                |
| New plan-gated action | A `CreatorIntent` (checkout reference), then call it with `editor.attempt`.                                                                                                                                                                                                                                            |
| New PRO feature       | `ProFeatureSchema` and `proFeaturesOf` in `packages/shared-types/src/plans.ts`, a `checkout.proFeature.<NAME>` message in both languages, and the `PRO` badge on the control that adds it.                                                                                                                             |

## Decisions

- 2026-11-24: editing a draft never opens the upgrade sheet or redirects to payment. PRO options carry a discreet
  `PRO` badge and the sticky bar sums up the ones in use.
- 2026-11-24: deleting a gift needs a double confirmation with the typed word `DELETE` / `BORRAR`.

## Change checklist

- Code: the files in the table above; every change to the gift goes through `run`, `attempt` or `withGrant`.
- Tests: `apps/web/src/features/gift-creator/components/GiftEditor.test.tsx` (free editing, PRO marks,
  limits of a published gift, locking, danger zone),
  `apps/web/src/features/gift-creator/card-form.test.ts`,
  `apps/web/src/features/gift-creator/components/SavedInput.test.tsx`,
  `apps/web/src/features/gift-creator/storage.test.ts`; `apps/web/e2e/gift-flow.spec.ts` when the flow
  changes.
- Strings: `creator` namespace in both message files.
- References: this file; `.claude/skills/frontend/references/api-client.md` for a new call;
  `.claude/skills/backend/references/endpoints.md` and `.claude/skills/backend/references/contracts.md`
  when the API or a schema changes.
