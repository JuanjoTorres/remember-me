import type { GiftEditorView } from '@remember-me/shared-types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { giftView, photoCards, renderApp } from '../../../../test/render';
import { ApiClientError } from '../../shared/api/client';
import * as creatorApi from '../api';
import { GiftEditor } from './GiftEditor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/features/checkout/api', () => ({
  getPrices: vi.fn().mockResolvedValue({
    premium: { amount: 499, currency: 'eur' },
    customSlug: { amount: 199, currency: 'eur' },
  }),
  getSlugAvailability: vi.fn(),
  createCheckoutSession: vi.fn(),
}));
vi.mock('../api');

function mockApi(gift: GiftEditorView) {
  const api = {
    get: vi.fn().mockResolvedValue(gift),
    update: vi.fn().mockResolvedValue(gift),
    remove: vi.fn(),
    publish: vi.fn().mockResolvedValue({ ...gift, status: 'PUBLISHED' }),
    changeSlug: vi.fn(),
    addCard: vi.fn().mockResolvedValue(gift),
    updateCard: vi.fn(),
    removeCard: vi.fn(),
    reorderCards: vi.fn(),
  };
  vi.mocked(creatorApi.giftApi).mockReturnValue(api);
  vi.mocked(creatorApi.downloadQr).mockResolvedValue(new Blob(['png']));
  return api;
}

async function renderEditor(gift: GiftEditorView) {
  const api = mockApi(gift);
  renderApp(<GiftEditor giftId={gift.id} editToken="secret-token" />);
  await screen.findByRole('heading', {
    name: gift.status === 'PUBLISHED' ? 'Your gift is live' : 'Build the story',
  });
  return api;
}

const upgradeSheet = () => screen.findByRole('dialog', { name: 'The full experience' });

describe('GiftEditor upgrade triggers', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:qr');
    URL.revokeObjectURL = vi.fn();
  });

  it('opens the upgrade sheet when a free gift adds a voice note', async () => {
    await renderEditor(giftView());
    await userEvent.click(screen.getByRole('button', { name: /Voice note/ }));
    expect(within(await upgradeSheet()).getByText(/Voice notes and trivia/)).toBeInTheDocument();
  });

  it('opens the upgrade sheet when a free gift adds a trivia', async () => {
    await renderEditor(giftView());
    await userEvent.click(screen.getByRole('button', { name: /Trivia/ }));
    expect(await upgradeSheet()).toBeInTheDocument();
  });

  it('opens the upgrade sheet on the fourth card, and the card form before that', async () => {
    await renderEditor(giftView({ cards: photoCards(2) }));
    await userEvent.click(screen.getByRole('button', { name: /\+ Photo & text/ }));
    expect(await screen.findByRole('dialog', { name: 'Photo & text' })).toBeInTheDocument();
  });

  it('opens the upgrade sheet on the fourth card', async () => {
    await renderEditor(giftView({ cards: photoCards(3) }));
    expect(screen.getByText('3 of 3 cards on the free plan.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /\+ Photo & text/ }));
    expect(within(await upgradeSheet()).getByText(/up to 3 cards/)).toBeInTheDocument();
  });

  it('opens the upgrade sheet for a premium reveal and saves the basic one', async () => {
    const api = await renderEditor(giftView({ cards: photoCards(1) }));
    await userEvent.click(screen.getByRole('button', { name: /Scratch card/ }));
    expect(
      within(await upgradeSheet()).getByText(/scratch card, the boarding pass/),
    ).toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('opens the upgrade sheet for "Publish without watermark" and publishes free otherwise', async () => {
    const api = await renderEditor(giftView({ cards: photoCards(1) }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish without watermark' }));
    expect(
      within(await upgradeSheet()).getByText(/remove “Created with kardoo.me”/),
    ).toBeInTheDocument();
    expect(api.publish).not.toHaveBeenCalled();
  });

  it('publishes a free gift directly with the free button', async () => {
    const api = await renderEditor(giftView({ cards: photoCards(1) }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish free' }));
    expect(api.publish).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'Your gift is live' })).toBeInTheDocument();
  });

  it('opens the upgrade sheet when the server refuses with PREMIUM_REQUIRED', async () => {
    // The local check passes (2 cards) but the server knows better, e.g. another tab added one.
    const api = await renderEditor(giftView({ cards: photoCards(2) }));
    api.addCard.mockRejectedValue(
      new ApiClientError(402, 'PREMIUM_REQUIRED', 'limit', { capability: 'MAX_CARDS' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /\+ Photo & text/ }));
    await userEvent.type(await screen.findByRole('textbox', { name: /Text/ }), 'One more');
    await userEvent.click(screen.getByRole('button', { name: 'Add card' }));
    expect(within(await upgradeSheet()).getByText(/up to 3 cards/)).toBeInTheDocument();
  });

  it('cannot publish an incomplete gift and says what is missing', async () => {
    await renderEditor(
      giftView({
        reveal: { template: 'BASIC', headline: '', message: '', detail: '', imageUrl: null },
      }),
    );
    expect(screen.getByText('Still missing: a card · the surprise')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish free' })).toBeDisabled();
  });

  it('does not offer upgrades to a premium gift', async () => {
    const api = await renderEditor(giftView({ plan: 'PREMIUM', cards: photoCards(3) }));
    expect(
      screen.queryByRole('button', { name: 'Publish without watermark' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Gift box/ }));
    expect(api.update).toHaveBeenCalledWith({ reveal: { template: 'GIFT_BOX' } });
    await userEvent.click(screen.getByRole('button', { name: /\+ Trivia/ }));
    expect(await screen.findByRole('dialog', { name: 'Trivia question' })).toBeInTheDocument();
  });

  it('shows the QR download once published', async () => {
    await renderEditor(giftView({ status: 'PUBLISHED', cards: photoCards(1) }));
    expect(await screen.findByRole('img', { name: 'QR code of your gift' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download QR' })).toBeInTheDocument();
    expect(screen.getByText('kardoo.me/for/gift-x9k2bd')).toBeInTheDocument();
  });
});
