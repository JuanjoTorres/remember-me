# Texts, languages and the brand

Read this before adding or changing any text the user sees, a language, or anything that shows the product
name.

## Locales

- Supported: `LOCALES` in `apps/web/src/i18n/locale.ts` (`en`, `es`); default `DEFAULT_LOCALE`. The same
  list exists as `LocaleSchema` in `packages/shared-types/src/gifts.ts` for the API; keep them equal.
- There are no locale segments in URLs.
- `resolveLocale(cookie, acceptLanguage)`: the cookie named by `LOCALE_COOKIE` wins if it holds a supported
  locale; otherwise the `Accept-Language` header by weight; otherwise the default. Tested in
  `apps/web/src/i18n/locale.test.ts`.
- Nothing in the app sets that cookie today (there is no language switcher); in practice the browser
  language decides.
- `apps/web/src/i18n/request.ts` is the next-intl request config (wired in `apps/web/next.config.ts`). An
  explicit locale passed to `getTranslations` wins; otherwise the visitor's locale is used. It loads the
  matching file from `apps/web/messages`.

Which language a screen uses:

| Screen                                | Language                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Home, privacy, editor, checkout       | The visitor's                                                              |
| Gift experience and its page metadata | The gift's `locale`, fixed when the gift was created (`createGift`)        |
| Gift not-found page                   | The visitor's                                                              |
| Gift error page                       | `<html lang>`, from the local texts in `apps/web/src/app/(gift)/error.tsx` |

## How texts reach components

- Server components: `getTranslations(namespace)` from next-intl's server entry.
- Client components under `apps/web/src/app/(main)`: `useTranslations(namespace)`; the provider is in
  `apps/web/src/app/(main)/layout.tsx`.
- Recipient client components: no hook. `apps/web/src/features/gift-experience/labels.ts` resolves the
  strings on the server and passes them as props.
- Message keys are type-checked: `apps/web/src/i18n/messages.d.ts` declares the messages type from
  `apps/web/messages/en.json`. A key missing in English is a type error.

## Message files

`apps/web/messages/en.json` and `apps/web/messages/es.json` have the same shape: one top-level object per
namespace.

| Namespace    | Used by                                                             | Notable nested groups                                           |
| ------------ | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `home`       | `apps/web/src/app/(main)/page.tsx`                                  | none                                                            |
| `creator`    | Everything in `gift-creator`                                        | `cardType`, `cardTitle`, `template`, `templateHint` (enum keys) |
| `checkout`   | Everything in `checkout`                                            | `reason` (one key per `UpgradeReason`)                          |
| `experience` | `labels.ts`, gift page metadata, gift not-found page                | none                                                            |
| `privacy`    | `apps/web/src/app/(main)/privacy/page.tsx`                          | `s1`…`s6` title and text pairs                                  |
| `preview`    | `apps/web/src/app/(main)/create/[giftId]/preview/PreviewScreen.tsx` | Banner, publish button and the note under it                    |

Nested groups keyed by an enum value (`PHOTO_TEXT`, `SCRATCH_CARD`, `MAX_CARDS`…) are read with a template
string, so every enum member needs its key.

## Placeholders

- Simple named placeholders only (`{name}`, `{count}`, `{max}`, `{price}`, `{date}`, `{number}`, `{items}`,
  `{min}`, `{brand}`). No ICU plural or select is used today.
- Prices and plan limits come from code, never from the text: `{max}` from `gift.capabilities.maxCards` or
  `PLAN_CAPABILITIES`, `{min}`/`{max}` of the slug from `SLUG_MIN_LENGTH` / `SLUG_MAX_LENGTH`, `{price}`
  from `formatPrice` over API amounts.
- Three messages do spell out a technical number that also lives in code; change both together:
  `creator.audioHint` (`MAX_RECORDING_MS` in `MediaInputs.tsx`), `creator.optionsHint` (the option count of
  `TriviaPayloadSchema`) and `creator.templateHint.GIFT_BOX` (`TAPS_TO_OPEN` in `GiftBoxReveal.tsx`).
- Dates and prices are formatted in code with the UI locale (`toLocaleDateString`, `formatPrice` in
  `apps/web/src/features/shared/format.ts`) and passed in as strings.

## Brand

- `apps/web/src/features/shared/brand.ts` exports `BRAND` (`name`, `tld`) and `BRAND_NAME`. It is the only
  place the public name is written.
- `BrandMark` (`apps/web/src/features/shared/ui/BrandMark.tsx`) renders the wordmark with the ending in the
  accent colour. Use it for the logo; use `BRAND_NAME` for plain text and metadata.
- Messages never contain the name: they use `{brand}` and the caller passes `BRAND_NAME`. Keys that take it
  today: `creator.watermarkNote`, `checkout.reason.*` (all reasons receive it), `experience.watermark`,
  `experience.notFoundHome`, `privacy.intro`, `privacy.back`.
- The old name still appears on purpose in non-brand identifiers: the package scope, the `localStorage` key
  in `apps/web/src/features/gift-creator/storage.ts`, and the QR download file name in `SharePanel.tsx`
  (asserted by the e2e specs). Changing either is a behaviour change, not a rename.

## Keeping languages in sync

`apps/web/test/messages.test.ts` fails when the two files do not have exactly the same keys, or when a key
uses different `{placeholders}` in the two languages. Do not edit that test to get a string in; add the
missing translation.

## Add a string

1. Add the key to the right namespace in `apps/web/messages/en.json` and the translation under the same key
   in `apps/web/messages/es.json`, with the same placeholders.
2. Use it with `t('key')` (creator side) or add it to `ExperienceLabels` and `experienceLabels` (recipient
   side).
3. No brand name, price or limit in the text: use a placeholder.
4. If a test or e2e spec looks the element up by its English text, update that lookup.

## Periods and limits in texts

A text never contains a number of cards, days, hours or years. Messages take them as values (`{max}`,
`{years}`, `{hours}`, `{draftDays}`…) from `PLAN_CAPABILITIES` and
`packages/shared-types/src/lifecycle.ts`; the privacy page passes the retention periods to every section.
`apps/web/src/i18n/experience-messages.ts` exports the recipient texts of every language for the preview
page; import it only from server components.

## Add a namespace or a language

- Namespace: a new top-level object in both files, and a row in the table above.
- Language: `LOCALES`, a new file in `apps/web/messages`, `LocaleSchema` in shared-types (and the API side),
  the comparison in `apps/web/test/messages.test.ts`, and the `TEXT` object in
  `apps/web/src/app/(gift)/error.tsx`.

## Decisions

None recorded yet.

## Change checklist

- Both message files, same keys, same placeholders; run `pnpm --filter web test`.
- Recipient text: `ExperienceLabels`, `experienceLabels`, and the `labels` fixture in
  `apps/web/src/features/gift-experience/GiftExperience.test.tsx`.
- Text asserted by tests: component tests render the English messages; `apps/web/e2e` specs use English
  labels and one Spanish heading.
- New namespace, locale rule or brand rule: update this file.
- Locale list changed: `.claude/skills/backend/references/contracts.md`.
