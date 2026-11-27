import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { GiftEditorView } from '@remember-me/shared-types';
import { PLAN_CAPABILITIES } from '@remember-me/shared-types';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import messages from '../messages/en.json';

/** Renders with the providers the editor runs under, using the English messages. */
export function renderApp(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

export function giftView(overrides: Partial<GiftEditorView> = {}): GiftEditorView {
  const plan = overrides.plan ?? 'FREE';
  return {
    id: '3f0e6f0a-58a1-4d53-a4a9-3c2a0f6d2b11',
    slug: 'gift-x9k2',
    status: 'DRAFT',
    plan,
    capabilities: PLAN_CAPABILITIES[plan],
    locale: 'en',
    recipientName: 'Ana',
    senderName: 'Juan',
    reveal: { template: 'BASIC', headline: 'Lisbon!', message: '', detail: '', imageUrl: null },
    cards: [],
    proFeatures: [],
    publishedAt: null,
    editableUntil: null,
    locked: false,
    expiresAt: '2030-01-08T00:00:00.000Z',
    customSlugPending: false,
    publicUrl: 'https://kardoo.me/for/gift-x9k2',
    grant: 'grant-token',
    grantExpiresAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function photoCards(count: number): GiftEditorView['cards'] {
  return Array.from({ length: count }, (_, position) => ({
    id: `00000000-0000-4000-8000-00000000000${position}`,
    position,
    type: 'PHOTO_TEXT' as const,
    payload: { text: `Card ${position + 1}`, imageUrl: null },
  }));
}
