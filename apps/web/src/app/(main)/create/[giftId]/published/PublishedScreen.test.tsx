import type { GiftEditorView } from '@remember-me/shared-types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { giftView, photoCards, renderApp } from '../../../../../../test/render';
import * as creatorApi from '@/features/gift-creator/api';
import { saveGift } from '@/features/gift-creator/storage';
import { ApiClientError } from '@/features/shared/api/client';
import { PublishedScreen } from './PublishedScreen';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/features/checkout/api', () => ({
  getPrices: vi.fn().mockResolvedValue({
    premium: { amount: 499, currency: 'eur' },
    customSlug: { amount: 199, currency: 'eur' },
  }),
  checkSlug: vi.fn(),
  createCheckoutSession: vi.fn(),
}));
vi.mock('@/features/gift-creator/api');

const published = (overrides: Partial<GiftEditorView> = {}) =>
  giftView({
    status: 'PUBLISHED',
    cards: photoCards(1),
    publishedAt: '2030-01-01T10:00:00.000Z',
    editableUntil: '2030-01-03T10:00:00.000Z',
    expiresAt: '2031-01-01T10:00:00.000Z',
    ...overrides,
  });

function renderPublished(load: () => Promise<GiftEditorView>) {
  const api = {
    get: vi.fn(load),
    update: vi.fn(),
    remove: vi.fn(),
    publish: vi.fn(),
    changeSlug: vi.fn(),
    addCard: vi.fn(),
    updateCard: vi.fn(),
    removeCard: vi.fn(),
    reorderCards: vi.fn(),
  };
  vi.mocked(creatorApi.giftApi).mockReturnValue(api);
  vi.mocked(creatorApi.downloadQr).mockResolvedValue(new Blob(['png']));
  saveGift(giftView().id, 'secret-token');
  renderApp(<PublishedScreen giftId={giftView().id} />);
}

describe('PublishedScreen', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:qr');
    URL.revokeObjectURL = vi.fn();
  });

  it('hands over the link and the QR code of a gift published for free', async () => {
    renderPublished(async () => published());
    expect(await screen.findByRole('heading', { name: 'Your gift is live' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'QR code of your gift' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'kardoo.me/x9k2bd7m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download QR' })).toBeEnabled();
    expect(screen.getByText(/You can still fix typos and swap photos until/)).toHaveTextContent(
      '2030',
    );
    expect(screen.getByRole('link', { name: 'Back to the editor' })).toHaveAttribute(
      'href',
      `/create/${giftView().id}`,
    );
  });

  it('says until when a free gift stays online and offers to keep it forever', async () => {
    renderPublished(async () => published());
    expect(await screen.findByText(/Free gifts stay online until/)).toHaveTextContent('2031');
    await userEvent.click(
      screen.getByRole('button', { name: 'Keep it forever and remove the watermark' }),
    );
    const sheet = within(await screen.findByRole('dialog', { name: 'The full experience' }));
    expect(sheet.getByText('An eternal memory: it never expires')).toBeInTheDocument();
  });

  it('shows neither an expiry nor an upgrade for a paid gift', async () => {
    renderPublished(async () => published({ plan: 'PREMIUM', expiresAt: null }));
    await screen.findByRole('heading', { name: 'Your gift is live' });
    expect(screen.queryByText(/stay online until/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keep it forever/ })).not.toBeInTheDocument();
  });

  it('says that a delivered gift can no longer be edited', async () => {
    renderPublished(async () => published({ locked: true }));
    expect(
      await screen.findByText(/has been delivered and can no longer be edited/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/You can still fix typos/)).not.toBeInTheDocument();
  });

  it('sends a draft opened by hand to its preview instead of showing a QR code', async () => {
    renderPublished(async () => giftView({ cards: photoCards(1) }));
    expect(await screen.findByRole('link', { name: 'Preview and publish' })).toHaveAttribute(
      'href',
      `/create/${giftView().id}/preview`,
    );
    expect(screen.queryByRole('img', { name: 'QR code of your gift' })).not.toBeInTheDocument();
    expect(creatorApi.downloadQr).not.toHaveBeenCalled();
  });

  it('shows the no-access screen when the gift cannot be loaded', async () => {
    renderPublished(async () => {
      throw new ApiClientError(404, 'NOT_FOUND', 'gone');
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This gift can't be edited from here",
    );
  });
});
