# UI system

Read this before styling anything, using or changing `Button`, `Field` or `Sheet`, or adding an animation.

Styling is Tailwind CSS 4 utilities written in the components. There is no component library, no CSS
modules and no icon library (icons are text glyphs marked `aria-hidden`).

## Tokens (`apps/web/src/app/globals.css`)

Declared in the `@theme` block, so each one is available as a Tailwind utility (`bg-ember`, `text-ink-soft`,
`border-line`, `font-display`…). There is no Tailwind config file; `apps/web/postcss.config.mjs` only loads
the Tailwind plugin.

| Token          | Used for                                                        |
| -------------- | --------------------------------------------------------------- |
| `ink`          | Main text on light surfaces                                     |
| `ink-soft`     | Secondary text, hints, labels                                   |
| `night`        | Recipient background, sheet backdrop                            |
| `paper`        | Site background; text on the dark recipient screens             |
| `paper-deep`   | Pressed states, soft panels, thumbnails                         |
| `ember`        | Accent: primary buttons, step numbers, focus ring, brand ending |
| `ember-deep`   | Pressed primary, error text, danger                             |
| `gold`         | Premium badges, recipient highlights, scratch foil              |
| `line`         | Borders and dividers                                            |
| `font-display` | Serif stack for headings and the wordmark                       |
| `font-sans`    | System sans stack for everything else (the body default)        |

- Both font stacks are system fonts; no web font is loaded.
- Opacity variants are used freely (`text-paper/70`, `bg-night/50`, `bg-gold/25`).
- The same file sets the body background and colour, a global `:focus-visible` outline in `ember`, and a
  `prefers-reduced-motion` rule that cuts CSS animation and transition durations.
- A few places repeat token values as hex literals because they cannot use a class: `themeColor` in the two
  root layouts, confetti colours in `apps/web/src/features/gift-reveal/Reveal.tsx` and
  `apps/web/src/features/checkout/PaymentSuccess.tsx`, the canvas in
  `apps/web/src/features/gift-reveal/ScratchCardReveal.tsx`. Change them together with the token.
- One non-token colour is in use: Tailwind's `emerald-700` for the "available" state in
  `apps/web/src/features/checkout/CustomSlugField.tsx`.

To add or change a colour or font, edit the `@theme` block. Do not write hex values in class names.

## Shared components (`apps/web/src/features/shared/ui`)

### `Button` (`apps/web/src/features/shared/ui/Button.tsx`)

- Props: every native button attribute, plus `variant` (`primary` default, `secondary`, `ghost`, `danger`),
  `busy`, `block`.
- `type` defaults to `button`. `busy` disables it, sets `aria-busy` and shows a spinner. `block` makes it
  full width. `className` is appended, which is how callers make a smaller button (`min-h-…`, `px-…`,
  `text-sm`).
- Pill shape with a minimum height that suits touch. Links that look like buttons (home page call to
  action) repeat the classes on a `Link` instead.

### `Field`, `TextInput`, `TextArea` (`apps/web/src/features/shared/ui/Field.tsx`)

- `Field`: props `label`, optional `hint`, `children`. It renders a `<label>` around the control, so tests
  and assistive technology find the control by the label text (and by the hint, which is inside the label).
- `TextInput` and `TextArea` take the native attributes and share one control style (`CONTROL`); `className`
  is appended.
- For a field that saves by itself use `SavedInput` from `gift-creator`, inside a `Field`.
- Groups of controls (template picker, trivia options) use `fieldset` and `legend` styled like a field
  label. Hidden file inputs are `sr-only` with an `aria-label`.

### `Sheet` (`apps/web/src/features/shared/ui/Sheet.tsx`)

- Props: `open`, `onClose`, `title`, `closeLabel`, `children`.
- A bottom sheet with `role="dialog"`, `aria-modal`, labelled by its title. The backdrop is a button
  labelled `closeLabel`; tapping it or pressing Escape calls `onClose`.
- Focus: on open, focus moves into the panel on the next animation frame, unless it is already on something inside it (a field the user reached first keeps it); Tab and Shift+Tab stay inside it; on close, focus returns to
  the element that had it.
- Stacking: a module-level list (`openSheets`) records open sheets; only the top one reacts to the keyboard.
  This is what lets the upgrade sheet open over the card sheet and close without losing the card form.
- It locks body scroll while open and restores the previous value.
- The panel is limited in height in `dvh`, scrolls inside, and pads its bottom by the safe area.
- It stays mounted in the tree while closed (`AnimatePresence` handles enter and exit), so render the
  content conditionally if it must reset, as `CardSheet` does with a `key`.
- Tested by `apps/web/src/features/shared/ui/Sheet.test.tsx`.

### Others

- `BrandMark` (`apps/web/src/features/shared/ui/BrandMark.tsx`): the wordmark.
- `formatPrice`, `displayUrl` (`apps/web/src/features/shared/format.ts`).

## Mobile-first conventions

- One centred column: `mx-auto max-w-md` on every screen, including desktop.
- Heights use dynamic viewport units: `min-h-dvh` on site pages, `h-dvh` on the recipient screens, `dvh`
  maximums for media and the sheet. Do not use `vh` or `h-screen`.
- Safe areas: the recipient layout sets `viewportFit: 'cover'`; elements pinned to an edge pad with
  `env(safe-area-inset-…)` inside `max()` (sheet, sticky publish bar, recipient progress bar).
- The recipient body does not scroll (`overflow-hidden overscroll-none`); the experience must fit one
  screen.
- Layers: sheets `z-50`; the editor's sticky publish bar `z-30`. On the recipient screen: tap zones `z-10`,
  anything interactive inside a step `z-20`, the progress bar `z-30`.
- Pressed feedback uses `active:` styles; there are no hover styles.
- User photos are plain `<img>` elements with `object-cover`, a fixed aspect or a `dvh` maximum, and an
  eslint-disable comment explaining it; `next/image` is not used.
- Headings: `font-display` with `tracking-tight` and a tight leading; `text-balance` / `text-pretty` on
  short copy.

## Animation

- framer-motion is used in `Sheet.tsx`, `apps/web/src/features/gift-experience/GiftExperience.tsx`,
  `apps/web/src/features/gift-experience/cards/TriviaCard.tsx`, and the reveal templates `BasicReveal`,
  `GiftBoxReveal`, `TicketReveal`. The editor itself has no motion beyond the sheet.
- Patterns in use: `AnimatePresence` for enter/exit (`mode="wait"` for the story cross-fade); spring
  transitions for things that arrive; keyframe arrays for shakes and idle loops; changing `key` to replay
  an animation; `drag` with constraints for the ticket stub; `whileTap` for press feedback.
- Small state changes use CSS (`transition-…`, `animate-spin` for spinners).
- Reduced motion: CSS animations and transitions are shortened globally; both confetti calls check
  `prefers-reduced-motion` themselves. framer-motion animations are not gated today.
- Confetti (`canvas-confetti`) is only fired from `Reveal.tsx` and `PaymentSuccess.tsx`.

## Decisions

None recorded yet.

## Change checklist

- New token or changed value: `apps/web/src/app/globals.css`, the hex copies listed above, this file.
- Changed `Button`, `Field` or `Sheet` props or behaviour: every caller, `Sheet.test.tsx`, this file.
- New shared component: put it in `apps/web/src/features/shared/ui`, no feature imports, no hooks unless it
  is a client file; add it here.
- New full-screen or pinned element: `dvh` and safe-area padding; check it at phone width.
- New animation on the recipient path: keep it in framer-motion or CSS (no new library) and give
  gesture-only interactions a tap alternative.
