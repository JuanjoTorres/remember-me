'use client';

import {
  type Card,
  CARD_TEXT_MAX,
  type CardInput,
  CardInputSchema,
  type CardType,
} from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/features/shared/ui/Button';
import { Field, TextArea, TextInput } from '@/features/shared/ui/Field';
import { Sheet } from '@/features/shared/ui/Sheet';
import type { GiftEditor } from '../useGiftEditor';
import { AudioInput, ImagePicker } from './MediaInputs';

/** What the sheet is editing: a new card of a type, or an existing card. */
export type CardDraft = { type: CardType; card?: Card };

interface CardSheetProps {
  draft: CardDraft | null;
  editor: GiftEditor;
  onClose: () => void;
}

export interface CardFormState {
  text: string;
  imageUrl: string | null;
  audioUrl: string | null;
  caption: string;
  question: string;
  options: string[];
  correctIndex: number;
  successMessage: string;
}

function initialState(card: Card | undefined): CardFormState {
  const base: CardFormState = {
    text: '',
    imageUrl: null,
    audioUrl: null,
    caption: '',
    question: '',
    options: ['', ''],
    correctIndex: 0,
    successMessage: '',
  };
  if (!card) return base;
  switch (card.type) {
    case 'PHOTO_TEXT':
      return { ...base, text: card.payload.text, imageUrl: card.payload.imageUrl };
    case 'AUDIO_NOTE':
      return {
        ...base,
        audioUrl: card.payload.audioUrl,
        imageUrl: card.payload.imageUrl,
        caption: card.payload.caption,
      };
    case 'TRIVIA':
      return { ...base, ...card.payload, options: [...card.payload.options] };
  }
}

/** Builds the request for a card from the form; empty trivia answers are dropped. */
export function toCardInput(type: CardType, form: CardFormState): unknown {
  switch (type) {
    case 'PHOTO_TEXT':
      return { type, payload: { text: form.text, imageUrl: form.imageUrl } };
    case 'AUDIO_NOTE':
      return {
        type,
        payload: { audioUrl: form.audioUrl ?? '', imageUrl: form.imageUrl, caption: form.caption },
      };
    case 'TRIVIA': {
      // Empty options are dropped; the correct answer follows its option to the new position.
      const kept = form.options
        .map((option, index) => ({ option: option.trim(), index }))
        .filter(({ option }) => option);
      return {
        type,
        payload: {
          question: form.question,
          options: kept.map(({ option }) => option),
          correctIndex: Math.max(
            0,
            kept.findIndex(({ index }) => index === form.correctIndex),
          ),
          successMessage: form.successMessage,
        },
      };
    }
  }
}

export function CardSheet({ draft, editor, onClose }: CardSheetProps) {
  const t = useTranslations('creator');
  return (
    <Sheet
      open={draft !== null}
      onClose={onClose}
      title={draft ? t(`cardTitle.${draft.type}`) : ''}
      closeLabel={t('close')}
    >
      {draft && (
        <CardForm
          key={draft.card?.id ?? draft.type}
          draft={draft}
          editor={editor}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function CardForm({
  draft,
  editor,
  onClose,
}: {
  draft: CardDraft;
  editor: GiftEditor;
  onClose: () => void;
}) {
  const t = useTranslations('creator');
  const [form, setForm] = useState(() => initialState(draft.card));
  // Uploads and recordings in progress; saving now would drop them from the card.
  const [pending, setPending] = useState(0);
  const onBusy = (busy: boolean) => setPending((count) => Math.max(0, count + (busy ? 1 : -1)));
  const set = <K extends keyof CardFormState>(key: K, value: CardFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const parsed = CardInputSchema.safeParse(toCardInput(draft.type, form));

  async function save() {
    if (!parsed.success) return;
    const card: CardInput = parsed.data;
    const cardId = draft.card?.id;
    const saved = await editor.run((api) =>
      cardId ? api.updateCard(cardId, card) : api.addCard(card),
    );
    // A refusal (plan limit) keeps the form open underneath the upgrade sheet.
    if (saved) onClose();
  }

  return (
    <div className="mt-5 space-y-4">
      {draft.type !== 'TRIVIA' && (
        <>
          {draft.type === 'AUDIO_NOTE' && (
            <AudioInput
              editor={editor}
              value={form.audioUrl}
              onChange={(url) => set('audioUrl', url)}
              onBusy={onBusy}
            />
          )}
          <ImagePicker
            editor={editor}
            value={form.imageUrl}
            onChange={(url) => set('imageUrl', url)}
            onBusy={onBusy}
          />
        </>
      )}

      {draft.type === 'PHOTO_TEXT' && (
        <Field label={t('cardText')} hint={`${form.text.length}/${CARD_TEXT_MAX}`}>
          <TextArea
            value={form.text}
            maxLength={CARD_TEXT_MAX}
            placeholder={t('cardTextPlaceholder')}
            onChange={(event) => set('text', event.target.value)}
          />
        </Field>
      )}

      {draft.type === 'AUDIO_NOTE' && (
        <Field label={t('caption')}>
          <TextInput
            value={form.caption}
            maxLength={140}
            onChange={(event) => set('caption', event.target.value)}
          />
        </Field>
      )}

      {draft.type === 'TRIVIA' && (
        <>
          <Field label={t('question')}>
            <TextInput
              value={form.question}
              maxLength={140}
              placeholder={t('questionPlaceholder')}
              onChange={(event) => set('question', event.target.value)}
            />
          </Field>
          <fieldset>
            <legend className="text-ink-soft mb-1.5 text-sm font-medium">{t('options')}</legend>
            <div className="space-y-2">
              {form.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correct"
                    className="accent-ember size-5 shrink-0"
                    checked={form.correctIndex === index}
                    aria-label={t('markCorrect', { number: index + 1 })}
                    onChange={() => set('correctIndex', index)}
                  />
                  <TextInput
                    value={option}
                    maxLength={60}
                    aria-label={t('option', { number: index + 1 })}
                    placeholder={t('option', { number: index + 1 })}
                    onChange={(event) =>
                      set(
                        'options',
                        form.options.map((current, i) =>
                          i === index ? event.target.value : current,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            {form.options.length < 4 && (
              <Button
                variant="ghost"
                className="mt-1 min-h-10 px-2 text-sm"
                onClick={() => set('options', [...form.options, ''])}
              >
                + {t('addOption')}
              </Button>
            )}
            <p className="text-ink-soft mt-1 text-sm">{t('optionsHint')}</p>
          </fieldset>
          <Field label={t('successMessage')}>
            <TextInput
              value={form.successMessage}
              maxLength={140}
              placeholder={t('successMessagePlaceholder')}
              onChange={(event) => set('successMessage', event.target.value)}
            />
          </Field>
        </>
      )}

      <Button block busy={editor.saving} disabled={!parsed.success || pending > 0} onClick={save}>
        {t(draft.card ? 'saveCard' : 'addCard')}
      </Button>
    </div>
  );
}
