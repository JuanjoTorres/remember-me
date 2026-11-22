'use client';

import type { Card } from '@remember-me/shared-types';
import { useTranslations } from 'next-intl';
import type { GiftEditor } from '../useGiftEditor';

interface CardListProps {
  cards: Card[];
  editor: GiftEditor;
  onEdit: (card: Card) => void;
}

function summary(card: Card): string {
  switch (card.type) {
    case 'PHOTO_TEXT':
      return card.payload.text;
    case 'AUDIO_NOTE':
      return card.payload.caption;
    case 'TRIVIA':
      return card.payload.question;
  }
}

const ICONS: Record<Card['type'], string> = { PHOTO_TEXT: '🖼', AUDIO_NOTE: '🎙', TRIVIA: '?' };

/** The story in order, with controls to edit, move and remove each card. */
export function CardList({ cards, editor, onEdit }: CardListProps) {
  const t = useTranslations('creator');

  function move(index: number, offset: -1 | 1) {
    const ids = cards.map((card) => card.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + offset, 0, moved as string);
    void editor.run((api) => api.reorderCards(ids));
  }

  if (cards.length === 0) {
    return (
      <p className="text-ink-soft border-line rounded-2xl border border-dashed px-4 py-6 text-center text-sm">
        {t('noCards')}
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {cards.map((card, index) => {
        const image = card.type === 'TRIVIA' ? null : card.payload.imageUrl;
        return (
          <li
            key={card.id}
            className="border-line flex items-center gap-3 rounded-2xl border bg-white p-2.5"
          >
            <button
              type="button"
              onClick={() => onEdit(card)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="bg-paper-deep flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- user media from object storage
                  <img src={image} alt="" className="size-full object-cover" />
                ) : (
                  <span aria-hidden>{ICONS[card.type]}</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="text-ink-soft block text-xs font-medium tracking-wide uppercase">
                  {index + 1} · {t(`cardType.${card.type}`)}
                </span>
                <span className="block truncate text-[0.95rem]">
                  {summary(card) || t('noText')}
                </span>
              </span>
            </button>
            <div className="flex shrink-0 items-center">
              <IconButton
                label={t('moveUp')}
                disabled={index === 0 || editor.saving}
                onClick={() => move(index, -1)}
              >
                ↑
              </IconButton>
              <IconButton
                label={t('moveDown')}
                disabled={index === cards.length - 1 || editor.saving}
                onClick={() => move(index, 1)}
              >
                ↓
              </IconButton>
              <IconButton
                label={t('removeCard')}
                disabled={editor.saving}
                onClick={() => void editor.run((api) => api.removeCard(card.id))}
              >
                ✕
              </IconButton>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function IconButton({
  label,
  children,
  ...props
}: {
  label: string;
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-ink-soft active:bg-paper-deep flex size-10 items-center justify-center rounded-full disabled:opacity-30"
      {...props}
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
