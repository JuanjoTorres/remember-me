# Routes

Read this before adding or changing a page, a layout, page metadata, or an error / not-found screen.

## Every route today

| Path                       | File                                                       | Renders                                                              |
| -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `/`                        | `apps/web/src/app/(main)/page.tsx`                         | Home: brand, pitch, three steps, link to `/create` and `/privacy`    |
| `/privacy`                 | `apps/web/src/app/(main)/privacy/page.tsx`                 | Privacy notice: intro plus sections `s1`…`s6` (the `SECTIONS` list)  |
| `/create`                  | `apps/web/src/app/(main)/create/page.tsx`                  | `CreateStart`: starts a gift or lists the gifts this device can edit |
| `/create/[giftId]`         | `apps/web/src/app/(main)/create/[giftId]/page.tsx`         | `EditorScreen`: `EditorGate` then `GiftEditor`                       |
| `/create/[giftId]/success` | `apps/web/src/app/(main)/create/[giftId]/success/page.tsx` | `SuccessScreen`: `EditorGate`, `PaymentSuccess`, `SharePanel`        |
| `/for/[slug]`              | `apps/web/src/app/for/[slug]/page.tsx`                     | `GiftExperience` with server-resolved labels                         |

All `page.tsx` files are server components. What differs is where the data comes from:

| Path                       | Data and how it is loaded                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/privacy`            | None. Texts with `getTranslations` (`home`, `privacy` namespaces) in the visitor's language.                                            |
| `/create`                  | Client side. Reads saved gifts from `localStorage`; with none saved it calls `createGift` and replaces the URL with `/create/[giftId]`. |
| `/create/[giftId]`         | Client side. Edit token from the URL fragment or storage, then `GET /gifts/:id` through `useGiftEditor` (TanStack Query).               |
| `/create/[giftId]/success` | Client side. Polls `GET /gifts/:id` until the plan is `PREMIUM`; also calls `POST /payments/confirm` (see checkout reference).          |
| `/for/[slug]`              | Server side. `getPublicGift(slug)` fetches `GET /public/gifts/:slug` through `INTERNAL_API_URL`, uncached, once per request.            |

## Layouts

| File                                        | Role                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web/src/app/(main)/layout.tsx`        | Root layout. `<html lang>` from the visitor's locale, `NextIntlClientProvider`, site metadata. |
| `apps/web/src/app/(main)/create/layout.tsx` | Wraps the editor routes in `Providers` (TanStack Query) and a centred `max-w-md` column.       |
| `apps/web/src/app/for/layout.tsx`           | Root layout of the recipient route. Dark body, `h-dvh`, no scrolling, no providers.            |

The two client screens that live next to their page
(`apps/web/src/app/(main)/create/[giftId]/EditorScreen.tsx` and
`apps/web/src/app/(main)/create/[giftId]/success/SuccessScreen.tsx`) are where features are joined.
`SuccessScreen` puts `PaymentSuccess` (`checkout`) around `EditorGate` and `SharePanel` (`gift-creator`),
because `checkout` does not import `gift-creator`. It also owns the `CONFIRM_EVERY_POLLS` constant and the
grant refresh used on the return page.

## Metadata, robots and headers

- Site metadata: `metadata` in `apps/web/src/app/(main)/layout.tsx` (title is `BRAND_NAME`; the description
  is a fixed English sentence, not a message). `viewport` sets the light theme colour.
- Privacy: `generateMetadata` builds the title from the `privacy.title` message and `BRAND_NAME`.
- Gift page: `generateMetadata` in `apps/web/src/app/for/[slug]/page.tsx` always returns
  `robots: { index: false, follow: false }` and `referrer: 'no-referrer'`, also when the gift does not
  exist. Title and description come from the `experience` namespace in the gift's language
  (`metaTitle` with the recipient's name, `metaTitleNoName` without).
- `apps/web/src/app/for/layout.tsx` sets `viewportFit: 'cover'` and the dark theme colour.
- HTTP headers for every path are set in `headers()` of `apps/web/next.config.ts` (nosniff, frame deny,
  referrer policy, HSTS, and a permissions policy that allows only the microphone for this origin). Paths
  under `/for/` get `Referrer-Policy: no-referrer`.
- There is no `robots.txt`, sitemap or `public` folder in `apps/web` today.

## Error and not-found handling

| Case                                           | What happens                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No published gift behind the slug              | `getPublicGift` returns `null`, the page calls `notFound()`, and `apps/web/src/app/for/[slug]/not-found.tsx` renders with status 404 in the visitor's language. |
| The API fails while loading a gift             | `getPublicGift` throws; `apps/web/src/app/for/error.tsx` shows a retry button that calls `reset`.                                                               |
| Editor opened without a usable edit token      | `EditorGate` shows the "no access" message and a link to `/create`.                                                                                             |
| Editor: API answers `UNAUTHORIZED`/`NOT_FOUND` | `GiftEditor` shows the same "no access" message; any other load error shows the "could not load" message.                                                       |
| Payment return page cannot load the gift       | `PaymentSuccess` shows the `failed` state with a reload button.                                                                                                 |

`apps/web/src/app/for/error.tsx` is a client component on a route with no translation provider, so it keeps
its English and Spanish texts in a local `TEXT` object and picks one from `document.documentElement.lang`.
This is the only place where user-facing strings live outside the message files; keep both languages there
in step by hand.

The `(main)` group has no `error.tsx` or `not-found.tsx`; Next.js defaults apply there.

## Decisions

None recorded yet.

## Change checklist

- New page: thin `page.tsx`, feature component, strings in both message files, a row in both tables above.
- New route a recipient opens: it must live under `apps/web/src/app/for` so the lint rule covers it; keep
  `robots` and `referrer` as in the gift page.
- New route group or layout: also update `.claude/skills/frontend/references/architecture.md`.
- A flow across pages changed: update or add a spec in `apps/web/e2e`
  (`.claude/skills/frontend/references/testing.md`).
- A page calls a new endpoint: `.claude/skills/frontend/references/api-client.md` and
  `.claude/skills/backend/references/endpoints.md`.
