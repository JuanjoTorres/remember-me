# The surprise (`gift-reveal`)

Read this before touching the last step of the recipient experience: a reveal template, the scratch logic,
confetti, the watermark, or before adding a template.

This feature is part of the recipient path: the same import limits as `gift-experience` apply
(`.claude/skills/frontend/references/gift-experience.md`).

## Pieces (`apps/web/src/features/gift-reveal`)

| File                    | Does                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Reveal.tsx`            | The step itself: picks the template component, owns `revealed`, fires confetti, calls `onRevealed`.         |
| `RevealContent.tsx`     | The uncovered surprise, shared by all templates: photo, headline, detail, message. `tone` is dark or light. |
| `BasicReveal.tsx`       | Template `BASIC` (free): a sealed envelope that opens with one tap.                                         |
| `ScratchCardReveal.tsx` | Template `SCRATCH_CARD`: a foil canvas over the content, rubbed away with finger or mouse.                  |
| `TicketReveal.tsx`      | Template `TICKET`: a boarding pass naming the recipient; the stub is dragged sideways or tapped.            |
| `GiftBoxReveal.tsx`     | Template `GIFT_BOX`: a box that shakes on each tap and opens after `TAPS_TO_OPEN` taps, showing the count.  |
| `scratch.ts`            | Pure scratch maths: `SCRATCH_THRESHOLD` and `clearedRatio`.                                                 |

## How a template is selected

- The creator chooses it in `apps/web/src/features/gift-creator/components/RevealSection.tsx`. The options
  are `RevealTemplateSchema.options`; a template missing from `gift.capabilities.revealTemplates` shows the
  premium badge and goes through `editor.attempt` with `PICK_REVEAL`. The API enforces the same rule.
- The recipient gets it as `gift.reveal.template` in `PublicGift`. `Reveal` looks the component up in
  `TEMPLATES`, a `Record<RevealTemplate, ComponentType<RevealProps>>`, so a template without a component
  does not compile.

## Contract between `Reveal` and a template

Every template receives `RevealProps`: `reveal` (the data), `revealed`, `onReveal`, `labels`
(`RevealLabels`), `recipientName`. A template:

- renders its "wrapped" state while `revealed` is false and calls `onReveal()` when the gesture completes;
- renders `RevealContent` once `revealed` is true;
- never fires confetti and never renders the watermark itself.

`onReveal` in `Reveal` is idempotent: it sets `revealed`, calls `celebrate()` and then `onRevealed`.
`Reveal` also renders the `revealNow` shortcut under every template except `BASIC`, so someone who cannot
perform the gesture can still open the gift. Keep it for any new gesture-based template.

`RevealLabels` has one string per template (the call to action) plus `ticketTitle`, `ticketPassenger` and
`revealNow`. They are filled on the server by `apps/web/src/features/gift-experience/labels.ts`.

## Scratch logic

- On mount the canvas backing store is sized to its displayed box, filled with a gold gradient, and the
  call-to-action label is drawn on it.
- Pointer events draw with `destination-out` and a round brush of `BRUSH_RADIUS`. A mouse scratches only
  while a button is pressed; pointer capture keeps the stroke when the finger leaves the canvas. The canvas
  has `touch-none` so the page does not scroll.
- Reading the canvas back is expensive, so the cleared share is measured only every few moves (the modulo in
  `scratch`), with `clearedRatio` sampling pixels by its `stride`. At `SCRATCH_THRESHOLD` it calls
  `onReveal()` and the canvas fades out with a CSS opacity transition.
- The content under the foil is `aria-hidden` until revealed. The canvas carries
  `data-testid="scratch-surface"`, used by the tests.

## Confetti

`celebrate()` in `Reveal.tsx` fires two `canvas-confetti` bursts, the second after a short timeout. It does
nothing when the visitor prefers reduced motion. The colours are hex literals that repeat the theme tokens
(ember, gold, paper); if a token changes in `apps/web/src/app/globals.css`, change them here and in
`apps/web/src/features/checkout/PaymentSuccess.tsx` too.

## Watermark

- Whether a gift has one is decided by the API: `PublicGift.watermark`, derived from
  `PLAN_CAPABILITIES[plan].watermark` (`packages/shared-types/src/plans.ts`). The web never decides it from
  the plan on the recipient side.
- It is rendered by `apps/web/src/features/gift-experience/GiftExperience.tsx`, not by this feature: a link
  to the home page with `data-testid="watermark"`, shown only after the reveal, next to "watch again".
- Its text is the `experience.watermark` message with `{brand}`.
- In the editor, `SharePanel` shows a note about it when `gift.capabilities.watermark` is true, and the
  `WATERMARK` upgrade reason offers to remove it.

## Add a template

Contract and API (see `.claude/skills/backend/references/contracts.md`):

1. `RevealTemplateSchema` and the `revealTemplates` lists of `PLAN_CAPABILITIES` in
   `packages/shared-types/src/plans.ts`; rebuild the package.
2. The `RevealTemplate` enum in `apps/api/prisma/schema.prisma` and a migration.

Web, recipient side:

3. A component in `apps/web/src/features/gift-reveal` that follows the contract above.
4. An entry in `TEMPLATES` in `Reveal.tsx`.
5. A line in `experienceLabels` and an `experience.reveal*` message in both languages.

Web, editor side:

6. An entry in `ICONS` in `RevealSection.tsx`, and `creator.template.<NAME>` and
   `creator.templateHint.<NAME>` in both message files. If the list of premium templates is named in a
   text (`checkout.reason.REVEAL_TEMPLATE`, `checkout.featureReveals`, `home.step2Text`), update it.

## Decisions

None recorded yet.

## Change checklist

- Tests: a case in `apps/web/src/features/gift-experience/GiftExperience.test.tsx` (its `labels` fixture
  needs the new key), `apps/web/src/features/gift-reveal/scratch.test.ts` for scratch maths,
  `apps/web/src/features/checkout/upgrade-triggers.test.ts` (it lists the premium templates), and the
  reveal part of `apps/web/e2e/premium-flow.spec.ts` or `apps/web/e2e/gift-flow.spec.ts`.
- Strings: `experience` and `creator` namespaces, both languages.
- References: this file; `.claude/skills/frontend/references/gift-creator.md` if the picker changes;
  `.claude/skills/backend/references/contracts.md` and `.claude/skills/backend/references/endpoints.md` for
  the contract and API side.
