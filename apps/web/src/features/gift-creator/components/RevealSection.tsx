'use client';

import type { GiftEditorView, Reveal, RevealTemplate } from '@remember-me/shared-types';
import { RevealTemplateSchema } from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { Field } from '@/features/shared/ui/Field';
import type { GiftEditor } from '../useGiftEditor';
import { ImagePicker } from './MediaInputs';
import { SavedInput } from './SavedInput';

const ICONS: Record<RevealTemplate, string> = {
  BASIC: '✉',
  SCRATCH_CARD: '✨',
  TICKET: '🎫',
  GIFT_BOX: '🎁',
};

/** The surprise at the end: how it is revealed and what it says. */
export function RevealSection({ gift, editor }: { gift: GiftEditorView; editor: GiftEditor }) {
  const t = useTranslations('creator');
  const save = (reveal: Partial<Reveal>) => void editor.run((api) => api.update({ reveal }));

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-ink-soft mb-1.5 text-sm font-medium">{t('revealTemplate')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {RevealTemplateSchema.options.map((template) => {
            const selected = gift.reveal.template === template;
            const locked = !gift.capabilities.revealTemplates.includes(template);
            return (
              <button
                key={template}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  editor.attempt({ kind: 'PICK_REVEAL', template }, () => save({ template }))
                }
                className={`relative rounded-2xl border bg-white px-3 py-3 text-left ${
                  selected ? 'border-ember ring-ember ring-1' : 'border-line'
                }`}
              >
                <span aria-hidden className="text-xl">
                  {ICONS[template]}
                </span>
                <span className="mt-1 block text-sm font-semibold">
                  {t(`template.${template}`)}
                </span>
                <span className="text-ink-soft block text-xs leading-snug">
                  {t(`templateHint.${template}`)}
                </span>
                {locked && (
                  <span className="bg-gold/25 text-ink absolute top-2 right-2 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold">
                    {t('premiumBadge')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Field label={t('revealHeadline')} hint={t('revealHeadlineHint')}>
        <SavedInput
          value={gift.reveal.headline}
          maxLength={60}
          placeholder={t('revealHeadlinePlaceholder')}
          onSave={(headline) => save({ headline })}
        />
      </Field>
      <Field label={t('revealMessage')}>
        <SavedInput
          multiline
          value={gift.reveal.message}
          maxLength={500}
          placeholder={t('revealMessagePlaceholder')}
          onSave={(message) => save({ message })}
        />
      </Field>
      <Field label={t('revealDetail')} hint={t('revealDetailHint')}>
        <SavedInput
          value={gift.reveal.detail}
          maxLength={60}
          placeholder={t('revealDetailPlaceholder')}
          onSave={(detail) => save({ detail })}
        />
      </Field>
      <div>
        <span className="text-ink-soft mb-1.5 block text-sm font-medium">{t('revealImage')}</span>
        <ImagePicker
          editor={editor}
          value={gift.reveal.imageUrl}
          onChange={(imageUrl) => save({ imageUrl })}
        />
      </div>
    </div>
  );
}
