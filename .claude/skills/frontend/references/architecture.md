# Architecture of `apps/web`

Read this before adding a feature or a route, moving code between folders, or adding a provider.

## Stack

Next.js App Router, React, TypeScript strict, Tailwind CSS 4, framer-motion, TanStack Query, next-intl,
`canvas-confetti`, Zod. Exact versions are in `apps/web/package.json`. The import alias `@/` maps to
`apps/web/src` (`apps/web/tsconfig.json`, `apps/web/vitest.config.ts`). The build output is `standalone`
(`apps/web/next.config.ts`), packaged by `apps/web/Dockerfile`.

## Folder map

| Folder                                  | Holds                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `apps/web/src/app/(main)`               | Root layout of the site: home, privacy, and the editor under `create`     |
| `apps/web/src/app/for`                  | Second root layout: the recipient route, isolated from the rest           |
| `apps/web/src/features/gift-creator`    | The editor: components, `useGiftEditor`, token storage, image compression |
| `apps/web/src/features/checkout`        | Upgrade triggers, upgrade sheet, custom link field, payment return        |
| `apps/web/src/features/gift-experience` | Recipient stories: server loader, labels, reducer, cards, preloading      |
| `apps/web/src/features/gift-reveal`     | The surprise step: one component per reveal template                      |
| `apps/web/src/features/shared`          | API client, brand, formatters, `Providers`, UI primitives in `ui`         |
| `apps/web/src/config`                   | `env.ts`: the only place that reads environment variables                 |
| `apps/web/src/i18n`                     | Locale resolution and the next-intl request config                        |
| `apps/web/messages`                     | `en.json` and `es.json`                                                   |
| `apps/web/test`                         | Vitest setup, render helpers, repo-level tests                            |
| `apps/web/e2e`                          | Playwright specs, helpers and the Stripe stand-in                         |

The `app` folder has no layout file of its own. The app has two root layouts, so each one renders its own
`<html>` and imports `apps/web/src/app/globals.css`:

- `apps/web/src/app/(main)/layout.tsx`: light theme, wraps children in `NextIntlClientProvider`.
- `apps/web/src/app/for/layout.tsx`: dark, full screen, no client provider at all.

`apps/web/src/instrumentation.ts` runs once at server start and calls `getServerEnv()` so that the server
refuses to boot with an invalid environment.

## Who may import whom

| From              | May import                                                     |
| ----------------- | -------------------------------------------------------------- |
| `app/(main)`      | any feature                                                    |
| `app/for`         | `gift-experience`, `gift-reveal`, `shared`                     |
| `gift-creator`    | `checkout`, `shared`                                           |
| `checkout`        | `shared` (it does not import `gift-creator` today; keep it so) |
| `gift-experience` | `gift-reveal`, `shared`                                        |
| `gift-reveal`     | nothing from other features today                              |
| `shared`          | `apps/web/src/config/env.ts` only                              |

Only the recipient rows are enforced by tooling; the rest is the convention the code follows today.
`checkout` receives what it needs from the editor as props (`gift`, `withGrant`, `loadGift`), which is why
it has no import of `gift-creator`.

## The recipient boundary

- Rule: `no-restricted-imports` in `apps/web/eslint.config.mjs`, applied to `src/app/for/**`,
  `src/features/gift-experience/**` and `src/features/gift-reveal/**`. It blocks `@/features/gift-creator`,
  `@/features/checkout`, `stripe`, `@stripe/*`, and relative paths that reach into those two features
  (always use the `@/features` alias so the rule can see the import).
- Test of the rule: `apps/web/test/recipient-boundaries.test.ts` lints snippets and expects one error per
  forbidden import, and none for allowed ones.
- Test of the result: `apps/web/e2e/gift-flow.spec.ts` records the scripts the recipient page downloads and
  fails if they contain editor, checkout or Stripe markers.
- Not enforced by a tool, but true today and required: recipient files use `import type` from
  `@remember-me/shared-types` (a value import would ship Zod), they do not use
  `apps/web/src/features/shared/api/client.ts`, `apps/web/src/features/shared/Providers.tsx` or
  `useTranslations`.

## Server and client components

- Pages are server components. A page that needs the browser renders a client component next to it
  (`apps/web/src/app/(main)/create/[giftId]/EditorScreen.tsx`,
  `apps/web/src/app/(main)/create/[giftId]/success/SuccessScreen.tsx`) or from a feature.
- Client files start with `'use client'`. Files without it that are still used from client components
  (`Button`, `Field`, `BrandMark`, `RevealContent`, `PhotoTextCard`) have no hooks; keep them that way.
- Providers: `NextIntlClientProvider` in `apps/web/src/app/(main)/layout.tsx`; TanStack Query
  (`Providers` in `apps/web/src/features/shared/Providers.tsx`, retries and refetch-on-focus off) only in
  `apps/web/src/app/(main)/create/layout.tsx`. Home and privacy have no query client.
- Server-only modules: `apps/web/src/features/gift-experience/get-public-gift.ts`,
  `apps/web/src/features/gift-experience/labels.ts`, `apps/web/src/i18n/request.ts`.

## Add a route

1. Decide the root layout: creator-facing pages go under `apps/web/src/app/(main)`; anything a recipient
   opens goes under `apps/web/src/app/for`.
2. Keep `page.tsx` thin: await `params`, load data if it is a server page, render a feature component.
3. Put strings in both message files and add the row to `.claude/skills/frontend/references/routes.md`.

## Add a feature

1. Create `apps/web/src/features/<name>` with its components, hooks, an `api.ts` for its endpoints and
   colocated `*.test.ts(x)` files.
2. If recipients load it, add its folder to the `files` list of the lint rule in
   `apps/web/eslint.config.mjs` and a case to `apps/web/test/recipient-boundaries.test.ts`.
3. Update the folder map and the import table above, and the routing table in
   `.claude/skills/frontend/SKILL.md`.

## Decisions

None recorded yet.

## Change checklist

- New or renamed folder, feature, provider or layout: update this file.
- Import rule changed: `apps/web/eslint.config.mjs` and `apps/web/test/recipient-boundaries.test.ts`
  together; never relax one to satisfy the other.
- New route: `.claude/skills/frontend/references/routes.md`.
- New env var: `.claude/skills/frontend/references/api-client.md`.
