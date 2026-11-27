import type { GiftEditorView } from '@remember-me/shared-types';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { giftView, photoCards, renderApp } from '../../../../test/render';
import { ApiClientError } from '../../shared/api/client';
import * as creatorApi from '../api';
import { GiftEditor } from './GiftEditor';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('@/features/checkout/api', () => ({
  getPrices: vi.fn().mockResolvedValue({
    premium: { amount: 499, currency: 'eur' },
    customSlug: { amount: 199, currency: 'eur' },
  }),
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

const published = (overrides: Partial<GiftEditorView> = {}) =>
  giftView({
    status: 'PUBLISHED',
    cards: photoCards(1),
    publishedAt: '2030-01-01T10:00:00.000Z',
    editableUntil: '2030-01-03T10:00:00.000Z',
    expiresAt: '2031-01-01T10:00:00.000Z',
    ...overrides,
  });

describe('GiftEditor', () => {
  beforeEach(() => {
    push.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:qr');
    URL.revokeObjectURL = vi.fn();
  });

  describe('a draft is edited without any paywall', () => {
    it('opens the form of a voice note and of a trivia on a free gift', async () => {
      await renderEditor(giftView());
      await userEvent.click(screen.getByRole('button', { name: /Voice note/ }));
      expect(await screen.findByRole('dialog', { name: 'Voice note' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'The full experience' })).not.toBeInTheDocument();
    });

    it('opens the card form past the free number of cards', async () => {
      await renderEditor(giftView({ cards: photoCards(5), proFeatures: ['EXTRA_CARDS'] }));
      await userEvent.click(screen.getByRole('button', { name: /\+ Photo & text/ }));
      expect(await screen.findByRole('dialog', { name: 'Photo & text' })).toBeInTheDocument();
    });

    it('saves a premium reveal straight away', async () => {
      const api = await renderEditor(giftView({ cards: photoCards(1) }));
      await userEvent.click(screen.getByRole('button', { name: /Scratch card/ }));
      expect(api.update).toHaveBeenCalledWith({ reveal: { template: 'SCRATCH_CARD' } });
      expect(screen.queryByRole('dialog', { name: 'The full experience' })).not.toBeInTheDocument();
    });

    it('marks with a PRO badge what the free plan does not include', async () => {
      await renderEditor(giftView({ cards: photoCards(1) }));
      const badge = (name: RegExp) =>
        within(screen.getByRole('button', { name })).queryByText('PRO');
      expect(badge(/Voice note/)).toBeInTheDocument();
      expect(badge(/Trivia/)).toBeInTheDocument();
      expect(badge(/Scratch card/)).toBeInTheDocument();
      expect(badge(/Gift box/)).toBeInTheDocument();
      // Still within the free plan.
      expect(badge(/\+ Photo & text/)).not.toBeInTheDocument();
      expect(badge(/Envelope/)).not.toBeInTheDocument();
    });

    it('marks one more photo card as PRO once the free cards are used', async () => {
      await renderEditor(giftView({ cards: photoCards(3) }));
      expect(screen.getByText(/3 cards so far. Up to 3 are free/)).toBeInTheDocument();
      expect(
        within(screen.getByRole('button', { name: /\+ Photo & text/ })).getByText('PRO'),
      ).toBeInTheDocument();
    });

    it('sums up the PRO features the gift uses, and none when it uses none', async () => {
      await renderEditor(
        giftView({
          cards: photoCards(4),
          proFeatures: ['EXTRA_CARDS', 'TRIVIA', 'PREMIUM_REVEAL'],
        }),
      );
      const summary = screen.getByTestId('pro-summary');
      expect(summary).toHaveTextContent(
        'PRO in this gift: More than 3 cards · Trivia · Premium reveal',
      );
      expect(summary).toHaveTextContent('One payment when you publish');
    });

    it('shows no PRO summary for a gift within the free plan', async () => {
      await renderEditor(giftView({ cards: photoCards(2) }));
      expect(screen.queryByTestId('pro-summary')).not.toBeInTheDocument();
    });

    it('goes to the preview to publish, and never publishes from the editor', async () => {
      const api = await renderEditor(giftView({ cards: photoCards(1) }));
      await userEvent.click(screen.getByRole('button', { name: 'Preview and publish' }));
      expect(push).toHaveBeenCalledWith(`/create/${giftView().id}/preview`);
      expect(api.publish).not.toHaveBeenCalled();
    });

    it('waits for a change that is still being saved before it opens the preview', async () => {
      const gift = giftView({ cards: photoCards(1) });
      const api = await renderEditor(gift);
      let finishSave: (saved: GiftEditorView) => void = () => undefined;
      api.update.mockReturnValue(new Promise<GiftEditorView>((resolve) => (finishSave = resolve)));

      // Leaving the field saves it; the tap on the button comes right behind.
      await userEvent.type(screen.getByRole('textbox', { name: 'From' }), ' Carlos');
      await userEvent.click(screen.getByRole('button', { name: 'Preview and publish' }));
      expect(api.update).toHaveBeenCalledWith({ senderName: 'Juan Carlos' });
      expect(push).not.toHaveBeenCalled();

      finishSave({ ...gift, senderName: 'Juan Carlos' });
      await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/create/${gift.id}/preview`));
    });

    it('stays in the editor and says so when the last change could not be saved', async () => {
      const gift = giftView({ cards: photoCards(1) });
      const api = await renderEditor(gift);
      let failSave: (error: Error) => void = () => undefined;
      api.update.mockReturnValue(new Promise<GiftEditorView>((_, reject) => (failSave = reject)));

      await userEvent.type(screen.getByRole('textbox', { name: 'From' }), ' Carlos');
      await userEvent.click(screen.getByRole('button', { name: 'Preview and publish' }));
      failSave(new Error('offline'));

      expect(await screen.findByText('That change could not be saved. Try again.')).toBeVisible();
      expect(push).not.toHaveBeenCalled();
    });

    it('sends a change that failed again before it opens the preview on a second tap', async () => {
      const gift = giftView({ cards: photoCards(1) });
      const api = await renderEditor(gift);
      api.update.mockRejectedValue(new Error('offline'));
      const preview = screen.getByRole('button', { name: 'Preview and publish' });

      await userEvent.type(screen.getByRole('textbox', { name: 'For' }), ' Maria');
      await userEvent.click(preview);
      expect(await screen.findByText('That change could not be saved. Try again.')).toBeVisible();
      await vi.waitFor(() => expect(preview).toBeEnabled());
      const attempts = api.update.mock.calls.length;

      // Still offline: the field shows a name that is not saved, so the editor stays.
      await userEvent.click(preview);
      await vi.waitFor(() => expect(api.update.mock.calls.length).toBeGreaterThan(attempts));
      await vi.waitFor(() => expect(preview).toBeEnabled());
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByText('That change could not be saved. Try again.')).toBeVisible();

      // Back online: the name the field shows is saved first, and only then the preview opens.
      const name = api.update.mock.lastCall![0] as { recipientName: string };
      api.update.mockResolvedValue({ ...gift, ...name });
      await userEvent.click(preview);
      await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/create/${gift.id}/preview`));
      expect(name.recipientName).toMatch(/ Maria$/);
      expect(api.update).toHaveBeenLastCalledWith(name);
    });

    it('does not send again a failed change that the creator has typed back', async () => {
      const gift = giftView({ cards: photoCards(1) });
      const api = await renderEditor(gift);
      api.update.mockRejectedValue(new Error('offline'));
      const field = screen.getByRole('textbox', { name: 'For' });
      const saved = (field as HTMLInputElement).value;

      await userEvent.type(field, ' Maria');
      await userEvent.tab();
      expect(await screen.findByText('That change could not be saved. Try again.')).toBeVisible();
      expect(api.update).toHaveBeenCalledTimes(1);

      // The creator puts the saved name back: nothing is left to save.
      await userEvent.clear(field);
      if (saved) await userEvent.type(field, saved);
      await userEvent.click(screen.getByRole('button', { name: 'Preview and publish' }));

      await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/create/${gift.id}/preview`));
      expect(api.update).toHaveBeenCalledTimes(1);
      expect(field).toHaveValue(saved);
    });

    it('saves a field that still has the focus before it opens the preview', async () => {
      const gift = giftView({ cards: photoCards(1) });
      const api = await renderEditor(gift);
      api.update.mockImplementation((changes: Partial<GiftEditorView>) =>
        Promise.resolve({ ...gift, ...changes }),
      );
      const field = screen.getByRole('textbox', { name: 'From' });
      await userEvent.type(field, ' Carlos');

      // A phone browser may leave the focus in the field when the button is tapped.
      fireEvent.click(screen.getByRole('button', { name: 'Preview and publish' }));
      expect(field).toHaveFocus();

      await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/create/${gift.id}/preview`));
      expect(api.update).toHaveBeenCalledWith({ senderName: 'Juan Carlos' });
    });

    it.each([
      { focus: 'still in the field', blur: false },
      { focus: 'out of the field', blur: true },
    ])(
      'undoes a change still being saved when the text was typed back, focus $focus',
      async ({ blur }) => {
        const gift = giftView({ cards: photoCards(1) });
        const api = await renderEditor(gift);
        const saves: ((saved: GiftEditorView) => void)[] = [];
        // The server keeps what it is sent, and answers when the test says so.
        let onServer = gift;
        api.update.mockImplementation(
          (changes: Partial<GiftEditorView>) =>
            new Promise<GiftEditorView>((resolve) =>
              saves.push(() => resolve((onServer = { ...onServer, ...changes }))),
            ),
        );
        const field = screen.getByRole('textbox', { name: 'From' });

        await userEvent.type(field, ' Carlos');
        await userEvent.tab();
        expect(api.update).toHaveBeenLastCalledWith({ senderName: 'Juan Carlos' });
        // The save is slow; meanwhile the creator puts the old name back.
        await userEvent.clear(field);
        await userEvent.type(field, 'Juan');
        if (blur) await userEvent.tab();
        fireEvent.click(screen.getByRole('button', { name: 'Preview and publish' }));

        saves[0]!(gift);
        await vi.waitFor(() => expect(saves).toHaveLength(2));
        expect(api.update).toHaveBeenLastCalledWith({ senderName: 'Juan' });
        expect(push).not.toHaveBeenCalled();

        saves[1]!(gift);
        await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/create/${gift.id}/preview`));
        expect(onServer.senderName).toBe('Juan');
        expect(field).toHaveValue('Juan');
      },
    );

    it('waits for a change started while it was waiting for an earlier one', async () => {
      const gift = giftView({ cards: photoCards(1) });
      const api = await renderEditor(gift);
      const saves: ((saved: GiftEditorView) => void)[] = [];
      api.update.mockImplementation(
        () => new Promise<GiftEditorView>((resolve) => saves.push(resolve)),
      );
      const from = screen.getByRole('textbox', { name: 'From' });

      await userEvent.type(from, ' Carlos');
      await userEvent.click(screen.getByRole('button', { name: 'Preview and publish' }));
      // The button is already waiting; the creator corrects the name once more.
      await userEvent.type(from, ' Luis');
      await userEvent.tab();
      expect(saves).toHaveLength(1);

      saves[0]!({ ...gift, senderName: 'Juan Carlos' });
      await vi.waitFor(() => expect(saves).toHaveLength(2));
      expect(api.update).toHaveBeenLastCalledWith({ senderName: 'Juan Carlos Luis' });
      expect(push).not.toHaveBeenCalled();

      saves[1]!({ ...gift, senderName: 'Juan Carlos Luis' });
      await vi.waitFor(() => expect(push).toHaveBeenCalledWith(`/create/${gift.id}/preview`));
    });

    it('cannot preview an incomplete gift and says what is missing', async () => {
      await renderEditor(
        giftView({
          reveal: { template: 'BASIC', headline: '', message: '', detail: '', imageUrl: null },
        }),
      );
      expect(screen.getByText('Still missing: a card · the surprise')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preview and publish' })).toBeDisabled();
    });

    it('says when an unpublished draft is deleted', async () => {
      await renderEditor(giftView());
      expect(screen.getByText(/A draft that is not published is deleted on/)).toHaveTextContent(
        '2030',
      );
    });
  });

  describe('a published free gift keeps the limits of its plan', () => {
    it('opens the upgrade sheet for a voice note', async () => {
      await renderEditor(published());
      await userEvent.click(screen.getByRole('button', { name: /Voice note/ }));
      expect(within(await upgradeSheet()).getByText(/Voice notes and trivia/)).toBeInTheDocument();
    });

    it('opens the upgrade sheet on the fourth card', async () => {
      await renderEditor(published({ cards: photoCards(3) }));
      await userEvent.click(screen.getByRole('button', { name: /\+ Photo & text/ }));
      expect(within(await upgradeSheet()).getByText(/up to 3 cards/)).toBeInTheDocument();
    });

    it('opens the upgrade sheet for a premium reveal and does not save it', async () => {
      const api = await renderEditor(published());
      await userEvent.click(screen.getByRole('button', { name: /Scratch card/ }));
      expect(
        within(await upgradeSheet()).getByText(/scratch card, the boarding pass/),
      ).toBeInTheDocument();
      expect(api.update).not.toHaveBeenCalled();
    });

    it('opens the upgrade sheet when the server refuses with PREMIUM_REQUIRED', async () => {
      // The local check passes (2 cards) but the server knows better, e.g. another tab added one.
      const api = await renderEditor(published({ cards: photoCards(2) }));
      api.addCard.mockRejectedValue(
        new ApiClientError(402, 'PREMIUM_REQUIRED', 'limit', { capability: 'MAX_CARDS' }),
      );
      await userEvent.click(screen.getByRole('button', { name: /\+ Photo & text/ }));
      await userEvent.type(await screen.findByRole('textbox', { name: /Text/ }), 'One more');
      await userEvent.click(screen.getByRole('button', { name: 'Add card' }));
      expect(within(await upgradeSheet()).getByText(/up to 3 cards/)).toBeInTheDocument();
    });

    it('says until when it stays online and offers to keep it forever', async () => {
      await renderEditor(published());
      expect(screen.getByText(/Free gifts stay online until/)).toHaveTextContent('2031');
      await userEvent.click(
        screen.getByRole('button', { name: 'Keep it forever and remove the watermark' }),
      );
      expect(
        within(await upgradeSheet()).getByText(/remove “Created with kardoo.me”/),
      ).toBeInTheDocument();
    });

    it('shows the QR download', async () => {
      await renderEditor(published());
      expect(await screen.findByRole('img', { name: 'QR code of your gift' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download QR' })).toBeInTheDocument();
      expect(screen.getByText('kardoo.me/x9k2bd7m')).toBeInTheDocument();
    });
  });

  it('does not offer upgrades to a premium gift', async () => {
    const api = await renderEditor(giftView({ plan: 'PREMIUM', cards: photoCards(3) }));
    expect(screen.queryByText('PRO')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Gift box/ }));
    expect(api.update).toHaveBeenCalledWith({ reveal: { template: 'GIFT_BOX' } });
    await userEvent.click(screen.getByRole('button', { name: /\+ Trivia/ }));
    expect(await screen.findByRole('dialog', { name: 'Trivia question' })).toBeInTheDocument();
  });

  describe('a delivered gift cannot be reused', () => {
    it("fixes the recipient's name once published, and nothing else during the grace period", async () => {
      await renderEditor(published());
      expect(screen.getByRole('textbox', { name: /^For/ })).toBeDisabled();
      expect(screen.getByText('The name is fixed once the gift is published.')).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'From' })).toBeEnabled();
      expect(screen.getByRole('button', { name: /\+ Photo & text/ })).toBeEnabled();
      expect(screen.getByTestId('edit-window')).toHaveTextContent(
        /You can still fix typos and swap photos until .*2030/,
      );
    });

    it('shows the deadline on the clock of the device, not of the server', async () => {
      // Where the creator is. The server that rendered the page may be anywhere (UTC in production).
      vi.stubEnv('TZ', 'America/Bogota');
      try {
        await renderEditor(published());
        expect(screen.getByTestId('edit-window')).toHaveTextContent(
          /until January 3, 2030\D+5:00\sAM;/,
        );
        expect(screen.getByText(/Free gifts stay online until/)).toHaveTextContent(
          'until January 1, 2031.',
        );
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('lets a draft change the name', async () => {
      await renderEditor(giftView());
      expect(screen.getByRole('textbox', { name: 'For' })).toBeEnabled();
    });

    it('turns every control of the story off once the gift is locked', async () => {
      await renderEditor(published({ locked: true }));
      expect(screen.getByTestId('edit-window')).toHaveTextContent(
        'This gift has been delivered and can no longer be edited',
      );
      for (const control of [
        screen.getByRole('textbox', { name: 'For' }),
        screen.getByRole('textbox', { name: 'From' }),
        screen.getByRole('button', { name: /\+ Photo & text/ }),
        screen.getByRole('button', { name: /Scratch card/ }),
        screen.getByRole('button', { name: 'Remove card' }),
        screen.getByRole('textbox', { name: /^The surprise/ }),
      ]) {
        expect(control).toBeDisabled();
      }
      // Handing it over and deleting it are still possible.
      expect(screen.getByRole('button', { name: 'Download QR' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Delete this gift' })).toBeEnabled();
    });

    it('explains a change the server refused because the window closed meanwhile', async () => {
      const gift = published();
      const api = await renderEditor(gift);
      api.update.mockRejectedValue(
        new ApiClientError(423, 'GIFT_LOCKED', 'locked', { scope: 'GIFT' }),
      );
      // The reload that follows the refusal shows the gift as it now is.
      api.get.mockResolvedValue({ ...gift, locked: true });

      const sender = screen.getByRole('textbox', { name: 'From' });
      await userEvent.clear(sender);
      await userEvent.type(sender, 'Tom');
      await userEvent.tab();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This gift was published more than 48 hours ago and can no longer be edited.',
      );
      expect(
        await screen.findByText(/has been delivered and can no longer be edited/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('danger zone', () => {
    it('deletes only after asking for it and typing the word', async () => {
      const api = await renderEditor(giftView());
      api.remove.mockResolvedValue(undefined);
      const zone = within(screen.getByRole('region', { name: 'Danger zone' }));

      await userEvent.click(zone.getByRole('button', { name: 'Delete this gift' }));
      const confirm = zone.getByRole('button', { name: 'Delete forever' });
      expect(confirm).toBeDisabled();
      expect(api.remove).not.toHaveBeenCalled();

      const word = zone.getByRole('textbox', { name: 'Type DELETE to confirm' });
      await userEvent.type(word, 'delet');
      expect(confirm).toBeDisabled();
      await userEvent.type(word, 'e');
      expect(confirm).toBeEnabled();

      await userEvent.click(confirm);
      expect(api.remove).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    });

    it('accepts the Spanish word too', async () => {
      await renderEditor(giftView());
      const zone = within(screen.getByRole('region', { name: 'Danger zone' }));
      await userEvent.click(zone.getByRole('button', { name: 'Delete this gift' }));
      await userEvent.type(zone.getByRole('textbox'), 'BORRAR');
      expect(zone.getByRole('button', { name: 'Delete forever' })).toBeEnabled();
    });

    it('can be cancelled, and starts over', async () => {
      const api = await renderEditor(giftView());
      const zone = within(screen.getByRole('region', { name: 'Danger zone' }));
      await userEvent.click(zone.getByRole('button', { name: 'Delete this gift' }));
      await userEvent.type(zone.getByRole('textbox'), 'DELETE');
      await userEvent.click(zone.getByRole('button', { name: 'Cancel' }));
      expect(zone.queryByRole('textbox')).not.toBeInTheDocument();

      await userEvent.click(zone.getByRole('button', { name: 'Delete this gift' }));
      expect(zone.getByRole('textbox')).toHaveValue('');
      expect(api.remove).not.toHaveBeenCalled();
    });

    it('keeps the gift and says so when the deletion fails', async () => {
      const api = await renderEditor(giftView());
      api.remove.mockRejectedValue(new Error('network'));
      const zone = within(screen.getByRole('region', { name: 'Danger zone' }));
      await userEvent.click(zone.getByRole('button', { name: 'Delete this gift' }));
      await userEvent.type(zone.getByRole('textbox'), 'DELETE');
      await userEvent.click(zone.getByRole('button', { name: 'Delete forever' }));
      expect(await zone.findByRole('alert')).toHaveTextContent('could not be deleted');
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe('a paid custom link that could not be applied', () => {
    const pending = () => published({ plan: 'PREMIUM', customSlugPending: true });

    it('lets the creator choose another name, and sends only the name', async () => {
      const gift = pending();
      const api = await renderEditor(gift);
      api.changeSlug.mockResolvedValue({
        ...gift,
        slug: '7k2m/for/nuestro-viaje',
        customSlugPending: false,
      });
      const save = screen.getByRole('button', { name: 'Use this link' });
      expect(save).toBeDisabled();

      await userEvent.type(screen.getByRole('textbox', { name: 'Custom link' }), 'Nuestro viaje');
      expect(screen.getByTestId('slug-preview')).toHaveTextContent(
        'kardoo.me/····/for/nuestro-viaje',
      );
      await userEvent.click(save);
      expect(api.changeSlug).toHaveBeenCalledExactlyOnceWith('nuestro-viaje');
      await vi.waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Use this link' })).not.toBeInTheDocument(),
      );
    });

    it('says so when the name could not be saved, and keeps the choice open', async () => {
      const api = await renderEditor(pending());
      api.changeSlug.mockRejectedValue(new Error('offline'));
      await userEvent.type(screen.getByRole('textbox', { name: 'Custom link' }), 'nuestro-viaje');
      await userEvent.click(screen.getByRole('button', { name: 'Use this link' }));
      expect(await screen.findByText('That name could not be saved. Try again.')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Use this link' })).toBeEnabled();
    });
  });
});
