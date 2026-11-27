# Routes

Read this before adding or changing a page, a layout, page metadata, or an error / not-found screen.

## Every route today

| Path                         | File                                                         | Renders                                                                                      |
| ---------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/`                          | `apps/web/src/app/(main)/page.tsx`                           | Home: brand, pitch, three steps, link to `/create` and `/privacy`                            |
| `/privacy`                   | `apps/web/src/app/(main)/privacy/page.tsx`                   | Privacy notice: intro plus sections `s1`…`s6` (the `SECTIONS` list)                          |
| `/create`                    | `apps/web/src/app/(main)/create/page.tsx`                    | `CreateStart`: starts a gift or lists the gifts this device can edit                         |
| `/create/[giftId]`           | `apps/web/src/app/(main)/create/[giftId]/page.tsx`           | `EditorScreen`: `EditorGate` then `GiftEditor`                                               |
| `/create/[giftId]/preview`   | `apps/web/src/app/(main)/create/[giftId]/preview/page.tsx`   | `PreviewScreen`: the whole experience under a "not published" banner, and the publish button |
| `/create/[giftId]/published` | `apps/web/src/app/(main)/create/[giftId]/published/page.tsx` | `PublishedScreen`: link and QR code of a gift published for free                             |
| `/create/[giftId]/success`   | `apps/web/src/app/(main)/create/[giftId]/success/page.tsx`   | `SuccessScreen`: `EditorGate`, `PaymentSuccess`, `SharePanel`                                |
| `/[code]`                    | `apps/web/src/app/(gift)/[code]/page.tsx`                    | `GiftPage` (`gift-experience`): a generated link, `kardoo.me/x9k2bd7m`                       |
| `/[code]/for/[name]`         | `apps/web/src/app/(gift)/[code]/for/[name]/page.tsx`         | `GiftPage`: a custom link, `kardoo.me/7k2m/for/ana-luis`                                     |

All `page.tsx` files are server components. What differs is where the data comes from:

| Path                            | Data and how it is loaded                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/privacy`                 | None. Texts with `getTranslations` (`home`, `privacy` namespaces) in the visitor's language.                                                                        |
| `/create`                       | Client side. Reads saved gifts from `localStorage`; with none saved it calls `createGift` and replaces the URL with `/create/[giftId]`.                             |
| `/create/[giftId]`              | Client side. Edit token from the URL fragment or storage, then `GET /gifts/:id` through `useGiftEditor` (TanStack Query).                                           |
| `/create/[giftId]/preview`      | Client side, through `useGiftEditor`. The server page only passes the recipient texts of every language (`EXPERIENCE_MESSAGES`) as a prop.                          |
| `/create/[giftId]/published`    | Client side, through `useGiftEditor`.                                                                                                                               |
| `/create/[giftId]/success`      | Client side. Polls `GET /gifts/:id` until the plan is `PREMIUM`; also calls `POST /payments/confirm` (see checkout reference).                                      |
| `/[code]`, `/[code]/for/[name]` | Server side. `getPublicGift(link)` fetches `GET /public/gifts/:code` or `GET /public/gifts/:code/for/:name` through `INTERNAL_API_URL`, uncached, once per request. |

## Layouts

| File                                        | Role                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web/src/app/(main)/layout.tsx`        | Root layout. `<html lang>` from the visitor's locale, `NextIntlClientProvider`, site metadata. |
| `apps/web/src/app/(main)/create/layout.tsx` | Wraps the editor routes in `Providers` (TanStack Query) and a centred `max-w-md` column.       |
| `apps/web/src/app/(gift)/layout.tsx`        | Root layout of the recipient route. Dark body, `h-dvh`, no scrolling, no providers.            |

The client screens that live next to their page
(`apps/web/src/app/(main)/create/[giftId]/EditorScreen.tsx`,
`apps/web/src/app/(main)/create/[giftId]/preview/PreviewScreen.tsx`,
`apps/web/src/app/(main)/create/[giftId]/published/PublishedScreen.tsx` and
`apps/web/src/app/(main)/create/[giftId]/success/SuccessScreen.tsx`) are where features are joined.

## The creator's journey

Editor (`/create/[giftId]`, nothing is paid or blocked) → preview (`/create/[giftId]/preview`) → "Publish
and get QR". From there:

- the gift uses no PRO feature: it is published free and the browser goes to `/create/[giftId]/published`;
- it uses PRO features: the API refuses, `PremiumUpgradeSheet` opens on the preview, Stripe Checkout
  returns to `/create/[giftId]/success`, which waits for the payment and shows the final QR code. The
  creator does not pass through the editor again. A cancelled checkout returns to the preview.

`PreviewScreen` renders `GiftExperience` with `embedded` inside a fixed full-screen container (the create
layout is a padded column), in the gift's language: it builds the labels in the browser with
`buildExperienceLabels` and a translator made from the messages the server page passed. `toPreviewGift`
turns the editor view into the recipient's view; the watermark shows only when the gift would be
published free. Every preview route needs the edit token (`EditorGate`); none takes it in the path.
`SuccessScreen` puts `PaymentSuccess` (`checkout`) around `EditorGate` and `SharePanel` (`gift-creator`),
because `checkout` does not import `gift-creator`. It also owns the `CONFIRM_EVERY_POLLS` constant and the
grant refresh used on the return page.

## Metadata, robots and headers

- Site metadata: `metadata` in `apps/web/src/app/(main)/layout.tsx` (title is `BRAND_NAME`; the description
  is a fixed English sentence, not a message). `viewport` sets the light theme colour.
- Privacy: `generateMetadata` builds the title from the `privacy.title` message and `BRAND_NAME`.
- Gift pages: `generateMetadata` of both gift routes calls `giftPageMetadata`
  (`apps/web/src/features/gift-experience/GiftPage.tsx`), which always returns
  `robots: { index: false, follow: false }` and `referrer: 'no-referrer'`, also when the gift does not
  exist. Title and description come from the `experience` namespace in the gift's language
  (`metaTitle` with the recipient's name, `metaTitleNoName` without).
- `apps/web/src/app/(gift)/layout.tsx` sets `viewportFit: 'cover'` and the dark theme colour.
- HTTP headers for every path are set in `headers()` of `apps/web/next.config.ts` (nosniff, frame deny,
  referrer policy, HSTS, and a permissions policy that allows only the microphone for this origin). The two
  shapes of a gift link get `Referrer-Policy: no-referrer`.
- There is no `robots.txt`, sitemap or `public` folder in `apps/web` today.

## Error and not-found handling

| Case                                              | What happens                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No published gift behind the link                 | `getPublicGift` returns `null`, the page calls `notFound()`, and `apps/web/src/app/(gift)/[code]/not-found.tsx` renders with status 404 in the visitor's language.                             |
| The visitor opened too many wrong links (API 429) | `getPublicGift` returns `REFUSED` and the page renders `TooManyAttempts` (texts `experience.refusedTitle` and `experience.refusedText`), which says to wait and never whether the link exists. |
| The API fails while loading a gift                | `getPublicGift` throws; `apps/web/src/app/(gift)/error.tsx` shows a retry button that calls `reset`.                                                                                           |
| Editor opened without a usable edit token         | `EditorGate` shows the "no access" message and a link to `/create`.                                                                                                                            |
| Editor: API answers `UNAUTHORIZED`/`NOT_FOUND`    | `GiftEditor` shows the same "no access" message; any other load error shows the "could not load" message.                                                                                      |
| Payment return page cannot load the gift          | `PaymentSuccess` shows the `failed` state with a reload button.                                                                                                                                |

`apps/web/src/app/(gift)/error.tsx` is a client component on a route with no translation provider, so it keeps
its English and Spanish texts in a local `TEXT` object and picks one from `document.documentElement.lang`.
This is the only place where user-facing strings live outside the message files; keep both languages there
in step by hand.

The `(main)` group has no `error.tsx` or `not-found.tsx`; Next.js defaults apply there.

## Decisions

- 2026-11-24: a gift is published from the preview, never from the editor.
- 2026-11-24 (kept from the existing design, not what the request literally named): the editor stays at
  `/create/[giftId]` and the preview at `/create/[giftId]/preview`, with the edit token in the URL
  fragment or in storage. Routes with the token in the path (`/edit/[editToken]`) were not added: a path
  is sent to the server and kept in logs and history.

## Change checklist

- New page: thin `page.tsx`, feature component, strings in both message files, a row in both tables above.
- New route a recipient opens: it must live under `apps/web/src/app/(gift)` so the lint rule covers it; keep
  `robots` and `referrer` as in the gift page.
- New route group or layout: also update `.claude/skills/frontend/references/architecture.md`.
- A flow across pages changed: update or add a spec in `apps/web/e2e`
  (`.claude/skills/frontend/references/testing.md`).
- A page calls a new endpoint: `.claude/skills/frontend/references/api-client.md` and
  `.claude/skills/backend/references/endpoints.md`.
