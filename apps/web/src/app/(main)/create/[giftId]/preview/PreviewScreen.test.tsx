import type { GiftEditorView } from '@remember-me/shared-types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { giftView, photoCards, renderApp } from '../../../../../../test/render';
import * as creatorApi from '@/features/gift-creator/api';
import { saveGift } from '@/features/gift-creator/storage';
import { ApiClientError } from '@/features/shared/api/client';
import { EXPERIENCE_MESSAGES } from '@/i18n/experience-messages';
import { PreviewScreen, toPreviewGift } from './PreviewScreen';

const router = { push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/features/checkout/api', () => ({
  getPrices: vi.fn().mockResolvedValue({
    premium: { amount: 499, currency: 'eur' },
    customSlug: { amount: 199, currency: 'eur' },
  }),
  checkSlug: vi.fn(),
  createCheckoutSession: vi.fn(),
}));
vi.mock('@/features/gift-creator/api');

const ready = (overrides: Partial<GiftEditorView> = {}) =>
  giftView({ cards: photoCards(2), ...overrides });

async function renderPreview(gift: GiftEditorView) {
  const api = {
    get: vi.fn().mockResolvedValue(gift),
    update: vi.fn(),
    remove: vi.fn(),
    publish: vi.fn().mockResolvedValue({ ...gift, status: 'PUBLISHED' }),
    changeSlug: vi.fn(),
    addCard: vi.fn(),
    updateCard: vi.fn(),
    removeCard: vi.fn(),
    reorderCards: vi.fn(),
  };
  vi.mocked(creatorApi.giftApi).mockReturnValue(api);
  saveGift(gift.id, 'secret-token');
  renderApp(<PreviewScreen giftId={gift.id} experienceMessages={EXPERIENCE_MESSAGES} />);
  await screen.findByRole('status');
  return api;
}

describe('toPreviewGift', () => {
  it('shows the watermark only on a gift that will be published for free', () => {
    expect(toPreviewGift(ready()).watermark).toBe(true);
    // Paid features mean it can only be published paid, and a paid gift has no watermark.
    expect(toPreviewGift(ready({ proFeatures: ['TRIVIA'] })).watermark).toBe(false);
    expect(toPreviewGift(ready({ plan: 'PREMIUM' })).watermark).toBe(false);
  });

  it('carries the story and the surprise, and nothing that is secret', () => {
    const gift = ready();
    const preview = toPreviewGift(gift);
    expect(preview).toMatchObject({ cards: gift.cards, reveal: gift.reveal, recipientName: 'Ana' });
    expect(JSON.stringify(preview)).not.toContain(gift.grant);
  });
});

describe('PreviewScreen', () => {
  beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
  });

  it('shows the experience under a banner that says it is not published', async () => {
    await renderPreview(ready());
    expect(screen.getByRole('status')).toHaveTextContent('Preview — not published yet');
    expect(screen.getByRole('heading', { name: 'For Ana' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      `/create/${giftView().id}`,
    );
  });

  it('shows the gift in the language it was written in, not in the language of the editor', async () => {
    await renderPreview(ready({ locale: 'es' }));
    expect(screen.getByRole('heading', { name: 'Para Ana' })).toBeInTheDocument();
    // The creator's own controls stay in the creator's language.
    expect(screen.getByRole('button', { name: 'Publish and get QR' })).toBeInTheDocument();
  });

  it('publishes a gift without PRO features for free and goes to its QR code', async () => {
    const gift = ready();
    const api = await renderPreview(gift);
    expect(screen.getByTestId('publish-note')).toHaveTextContent(
      'Free: it ends with “Created with kardoo.me” and stays online for 3 months.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Publish and get QR' }));
    expect(api.publish).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/create/${gift.id}/published`),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the payment sheet instead of publishing a gift that uses PRO features', async () => {
    const gift = ready({ proFeatures: ['VOICE_NOTE', 'PREMIUM_REVEAL'] });
    const api = await renderPreview(gift);
    api.publish.mockRejectedValue(
      new ApiClientError(402, 'PREMIUM_REQUIRED', 'pro', {
        capability: 'PRO_FEATURES',
        proFeatures: gift.proFeatures,
      }),
    );
    expect(screen.getByTestId('publish-note')).toHaveTextContent(
      'PRO: Voice note · Premium reveal. One payment to publish.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Publish and get QR' }));
    const sheet = within(await screen.findByRole('dialog', { name: 'The full experience' }));
    expect(sheet.getByText(/uses PRO features. One payment publishes it/)).toBeInTheDocument();
    expect(sheet.getByText('An eternal memory: it never expires')).toBeInTheDocument();
    expect(await sheet.findByRole('button', { name: 'Pay €4.99' })).toBeEnabled();
    expect(sheet.getByRole('checkbox')).not.toBeChecked();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('lets a free gift upgrade anyway, for the link, the watermark and no expiry', async () => {
    const api = await renderPreview(ready());
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove the watermark, pick the link, keep it forever' }),
    );
    expect(await screen.findByRole('dialog', { name: 'The full experience' })).toBeInTheDocument();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('does not publish an incomplete gift and says what is missing', async () => {
    await renderPreview(giftView());
    expect(screen.getByTestId('publish-note')).toHaveTextContent('Still missing: a card');
    expect(screen.getByRole('button', { name: 'Publish and get QR' })).toBeDisabled();
  });

  it('says that the gift could not be published when the request fails', async () => {
    const api = await renderPreview(ready());
    api.publish.mockRejectedValue(new Error('network'));
    await userEvent.click(screen.getByRole('button', { name: 'Publish and get QR' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be published');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('offers the QR code, not publication, for a gift that is already published', async () => {
    const gift = ready({ status: 'PUBLISHED' });
    await renderPreview(gift);
    expect(screen.getByRole('status')).toHaveTextContent('Preview — this gift is published');
    expect(screen.queryByRole('button', { name: 'Publish and get QR' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See the QR code' }));
    expect(router.push).toHaveBeenCalledWith(`/create/${gift.id}/published`);
  });
});
