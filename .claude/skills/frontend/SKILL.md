---
name: frontend
description: How the kardoo.me web app (apps/web, Next.js App Router) is built and which files to touch. MUST be loaded before adding or changing anything in apps/web - a page, component, feature, text, style or test.
---

# Frontend (`apps/web`)

`CLAUDE.md` wins over anything here. This file holds the rules and a routing table; the detail lives in one
reference per kind of change. Read only the reference you need. The references point at files, they do not
copy code: open the file they name.

## Rules that do not bend

- Code lives in `apps/web/src/features/<feature>` (`gift-creator`, `gift-experience`, `gift-reveal`,
  `checkout`, `shared`). Files under `apps/web/src/app` only compose features.
- The recipient path is `apps/web/src/app/for`, `gift-experience` and `gift-reveal`. It never imports
  `gift-creator`, `checkout` or Stripe (lint rule in `apps/web/eslint.config.mjs`, tested by
  `apps/web/test/recipient-boundaries.test.ts`), has no client providers, and imports only types from
  `@remember-me/shared-types`.
- Recipient texts are resolved on the server in the gift's language and passed down as props
  (`apps/web/src/features/gift-experience/labels.ts`). No `useTranslations` there.
- Every user-facing string goes in both `apps/web/messages/en.json` and `apps/web/messages/es.json`
  (`apps/web/test/messages.test.ts` fails otherwise).
- The brand name is written only in `apps/web/src/features/shared/brand.ts`. Components use `BrandMark` or
  `BRAND_NAME`; messages receive it as `{brand}`.
- Never write a price or a plan limit in a message or a component. Prices come from `GET /payments/prices`;
  limits come from `gift.capabilities` or `PLAN_CAPABILITIES` in `packages/shared-types/src/plans.ts`.
- Environment variables are read only through `apps/web/src/config/env.ts` (Zod-validated). The browser uses
  `NEXT_PUBLIC_API_URL`; server rendering uses `INTERNAL_API_URL`.
- Editor changes go through `useGiftEditor`: `run` for a change, `attempt` for an action that may need an
  upgrade, `withGrant` for media, QR and payment calls.
- API types come from `@remember-me/shared-types` (`z.infer`); never redeclare a contract type by hand.
- Mobile first: `dvh` units, safe-area padding, colours and fonts only from the tokens in
  `apps/web/src/app/globals.css`.
- Use `pnpm` only. Never open a `.env` file; `apps/web/.env.example` documents the variables.

## You are about to…

| Change                                                                      | Read                            |
| --------------------------------------------------------------------------- | ------------------------------- |
| Add a feature, move code, wonder what may import what, add a provider       | `references/architecture.md`    |
| Add or change a page, layout, metadata, error or not-found screen           | `references/routes.md`          |
| Touch the editor: cards, fields, media upload, saving, share panel, tokens  | `references/gift-creator.md`    |
| Touch upgrade triggers, the upgrade sheet, custom link, payment return      | `references/checkout.md`        |
| Touch what the recipient sees before the surprise (stories, cards, audio)   | `references/gift-experience.md` |
| Touch the surprise: templates, scratch, confetti, watermark                 | `references/gift-reveal.md`     |
| Call the API, handle an API error, add an endpoint call, add an env var     | `references/api-client.md`      |
| Add or change a text, a language, the brand name                            | `references/i18n-and-brand.md`  |
| Style something, use or change `Button`, `Field`, `Sheet`, add an animation | `references/ui-system.md`       |
| Write or fix a unit, component or browser test                              | `references/testing.md`         |

## Living documents

These files are part of the code.

- A change that adds, removes or renames a route, feature, shared component, hook, message namespace,
  upgrade trigger, env var, or a rule described here updates the matching reference in the same commit.
- When the user states "this is how we do X", record it in the matching reference under its "Decisions"
  heading, with the date.
- If a reference contradicts the code, the code wins: fix the reference.

## Before you finish

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`
- `pnpm test:e2e` when a user flow changed (it needs the build from the line above).
- `pnpm check:docs`
- The build needs `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` set (for example `http://localhost:4000`).
  `pnpm test` and `pnpm test:e2e` need Docker.
- Never weaken or delete a test to make it pass.
