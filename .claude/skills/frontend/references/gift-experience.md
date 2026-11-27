# The recipient story (`gift-experience`)

Read this before touching what a recipient sees at a gift's link (`/[code]`, or `/[code]/for/[name]` for a
custom link) up to the surprise: loading the gift, the
cover, the cards, navigation, audio, preloading.

This is the critical path: a phone that scanned a QR code. It must stay small and must not show a loading
state between cards.

## Flow

1. Both gift routes (`apps/web/src/app/(gift)/[code]/page.tsx` and
   `apps/web/src/app/(gift)/[code]/for/[name]/page.tsx`) render `GiftPage`
   (`apps/web/src/features/gift-experience/GiftPage.tsx`, server) with their params. It calls
   `getPublicGift(link)`; `null` means `notFound()`.
2. It calls `experienceLabels(gift)` and renders `GiftExperience` with `gift` and `labels`.
3. `GiftExperience` (client) walks the steps: cover, one step per card, reveal.
4. The reveal step renders `Reveal` from `apps/web/src/features/gift-reveal/Reveal.tsx`.

## Loading on the server (`apps/web/src/features/gift-experience/get-public-gift.ts`)

- Takes the link as `{ code, name? }` and fetches `GET /public/gifts/:code` or
  `GET /public/gifts/:code/for/:name` from `getServerEnv().INTERNAL_API_URL` with `cache: 'no-store'`.
  It uses `fetch` directly, not the shared API client.
- Wrapped in React `cache`, so `generateMetadata` and the page share one request.
- Forwards the first address of the incoming `x-forwarded-for` header as `X-Forwarded-For`, so the API rate
  limits per visitor and not per web server.
- 404 returns `null`; any other failure throws and ends in `apps/web/src/app/(gift)/error.tsx`.
- The result is typed as `PublicGift` (`packages/shared-types/src/gifts.ts`) without runtime validation.

## Labels (`apps/web/src/features/gift-experience/labels.ts`)

`experienceLabels` resolves every text on the server with `getTranslations`, passing `gift.locale` and the
`experience` namespace: the gift is shown in the language it was written in, whatever the phone's language
is. It
returns the `ExperienceLabels` object (declared in `GiftExperience.tsx`), including the nested `reveal`
labels (`RevealLabels`). The object itself is built by `buildExperienceLabels`
(`apps/web/src/features/gift-experience/build-labels.ts`), a pure function that takes a translator of the
`experience` namespace: names are interpolated there (`coverFor`, `coverFrom`; an empty sender gives an
empty string and the line is not rendered), and the watermark text gets `BRAND_NAME`. The creator's
preview calls the same function in the browser
(`apps/web/src/app/(main)/create/[giftId]/preview/PreviewScreen.tsx`), so preview and recipient page
cannot drift apart.

Client components in this feature never call `useTranslations`: there is no provider on this route. A new
text means a new key in `ExperienceLabels`, a line in `experienceLabels`, and the message in both languages.

## State (`apps/web/src/features/gift-experience/stories.ts`)

Pure functions, no React:

- `stepsOf(gift)`: `cover`, one `card` step per card, `reveal`.
- `StoryState`: `index` and `solved` (ids of trivia cards answered correctly).
- `storyReducer(steps, state, action)` with actions `next`, `previous`, `solve`, `restart`.
- `canAdvance`: false on the last step and on a trivia that is not solved yet. A solved trivia never blocks
  again.
- `mediaAhead(steps, index, revealImageUrl, ahead)`: image and audio URLs of the next steps, nearest first.

`GiftExperience` holds this state with `useReducer` and a separate `revealed` flag for the controls shown
after the surprise.

## `GiftExperience` (`apps/web/src/features/gift-experience/GiftExperience.tsx`)

- Layout: `h-dvh`, `max-w-md`, dark, `select-none`, `lang` set to the gift's locale. With the `embedded`
  prop it fills its container (`h-full`) instead of the screen and renders a `div` instead of the `main`
  landmark; only the creator's preview uses it.
- Progress bar: one segment per step, padded by the top safe area.
- Tap zones on every step except the reveal: the left third goes back, the rest goes forward; they are real
  buttons labelled with `labels.previous` / `labels.next` and disabled when the move is not allowed.
  Interactive content inside a step sits above them with a higher `z-` class.
- Keyboard: right and left arrows. Going back from the reveal clears `revealed`.
- Steps cross-fade with `AnimatePresence mode="wait"`, keyed by the step index.
- After the reveal: a "watch again" button (`restart`) and, when `gift.watermark` is true, the watermark link.

## Cards (`apps/web/src/features/gift-experience/cards`)

| Type         | File                | Behaviour                                                                                             |
| ------------ | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `PHOTO_TEXT` | `PhotoTextCard.tsx` | Photo with the text as caption, or large text alone. No hooks.                                        |
| `AUDIO_NOTE` | `AudioNoteCard.tsx` | Optional photo, one large play / pause button, progress bar, caption.                                 |
| `TRIVIA`     | `TriviaCard.tsx`    | Question and options. A wrong option is disabled and the list shakes; the right one calls `onSolved`. |

`GiftExperience` picks the component by `step.card.type`. After a trivia is solved it shows a "continue"
button; the status line shows the creator's `successMessage` or the default label.

User media is rendered with plain `<img>` (object storage URLs, not `next/image`), with an eslint-disable
comment that says why.

## Audio

`AudioNoteCard` renders an `<audio preload="auto">` element. On mount it tries to play (the tap that brought
the recipient here usually counts as a gesture); if the browser refuses, the play button is there. It pauses
on unmount, so leaving the card stops the sound. Progress comes from `timeupdate`.

## Preloading (`apps/web/src/features/gift-experience/usePreloadMedia.ts`)

While a step is shown, `usePreloadMedia(steps, index, revealImageUrl)` requests the media that `mediaAhead`
returns for the following steps (the look-ahead is the default of the `ahead` parameter), creating `Image`
and `Audio` objects. It keeps them in a ref map so a file is never requested twice and the request is not
cancelled by garbage collection. The reveal photo is included when the reveal is within the look-ahead.

## What must stay out of this bundle

- `gift-creator`, `checkout`, Stripe: blocked by lint.
- Value imports from `@remember-me/shared-types` (they pull in Zod): use `import type`.
- `apps/web/src/features/shared/api/client.ts`, TanStack Query, `NextIntlClientProvider`.
- `apps/web/e2e/gift-flow.spec.ts` fails if the scripts served to the recipient contain the markers it lists
  (edit token header, slug preview test id, checkout endpoint, the storage key, "stripe").

## Decisions

None recorded yet.

## Change checklist

- New text: `ExperienceLabels`, `buildExperienceLabels`, both message files (`experience` namespace), and the
  `labels` fixture in `apps/web/src/features/gift-experience/GiftExperience.test.tsx`.
- New card type: a component in the `cards` folder, a branch in `GiftExperience.tsx`, `mediaOf` in
  `stories.ts` if it carries media; plus the editor and contract side
  (`.claude/skills/frontend/references/gift-creator.md`).
- Navigation or preloading rule: `stories.ts` with `apps/web/src/features/gift-experience/stories.test.ts`
  and `apps/web/src/features/gift-experience/usePreloadMedia.test.ts`.
- Any change here: run the recipient part of `apps/web/e2e/gift-flow.spec.ts`.
- `PublicGift` shape or the public endpoint changed: `.claude/skills/backend/references/contracts.md` and
  `.claude/skills/backend/references/endpoints.md`.
