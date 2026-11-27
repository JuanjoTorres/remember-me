import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GiftEditorView } from '@remember-me/shared-types';
import { giftView, renderApp } from '../../../test/render';
import * as api from './api';
import { PremiumUpgradeSheet } from './PremiumUpgradeSheet';
import type { UpgradeReason } from './upgrade-triggers';

vi.mock('./api');

const gift = giftView();
const withGrant = <T,>(call: (grant: string) => Promise<T>) => call(gift.grant);

function open(
  reason: UpgradeReason,
  redirect = vi.fn(),
  options: { gift?: GiftEditorView; cancelPath?: string } = {},
) {
  renderApp(
    <PremiumUpgradeSheet
      reason={reason}
      onClose={() => undefined}
      gift={options.gift ?? gift}
      withGrant={withGrant}
      cancelPath={options.cancelPath}
      redirect={redirect}
    />,
  );
  return redirect;
}

const nameInput = () => screen.getByRole('textbox', { name: 'Custom link' });
const endingInput = () => screen.getByRole('textbox', { name: 'Ending' });
/** Types a name and an ending of the creator's own, replacing the random one. */
async function typeLink(name: string, ending: string) {
  await userEvent.clear(nameInput());
  await userEvent.type(nameInput(), name);
  await userEvent.clear(endingInput());
  if (ending) await userEvent.type(endingInput(), ending);
}

describe('PremiumUpgradeSheet', () => {
  beforeEach(() => {
    vi.mocked(api.getPrices).mockResolvedValue({
      premium: { amount: 499, currency: 'eur' },
      customSlug: { amount: 199, currency: 'eur' },
    });
    vi.mocked(api.checkSlug).mockImplementation(async (slug) =>
      slug === 'taken-link-2026'
        ? {
            slug,
            available: false,
            reason: 'TAKEN',
            suggestions: ['taken-link-k7m2', 'taken-link-p4x9', 'taken-link-z3b8'],
          }
        : { slug, available: true, suggestions: [] },
    );
    vi.mocked(api.createCheckoutSession).mockResolvedValue({
      orderId: '00000000-0000-4000-8000-000000000001',
      checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_1',
    });
  });

  it('stays closed without a reason', () => {
    renderApp(
      <PremiumUpgradeSheet
        reason={null}
        onClose={() => undefined}
        gift={gift}
        withGrant={withGrant}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['MAX_CARDS', /up to 3 cards/],
    ['CARD_TYPE', /Voice notes and trivia/],
    ['REVEAL_TEMPLATE', /scratch card, the boarding pass and the gift box/],
    ['WATERMARK', /remove “Created with kardoo.me”/],
    ['PRO_FEATURES', /uses PRO features. One payment publishes it/],
  ] as const)('explains why it opened: %s', async (reason, text) => {
    open(reason);
    expect(screen.getByRole('dialog', { name: 'The full experience' })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('shows the price that the API reports, not a built-in one', async () => {
    vi.mocked(api.getPrices).mockResolvedValue({
      premium: { amount: 725, currency: 'eur' },
      customSlug: { amount: 150, currency: 'eur' },
    });
    open('MAX_CARDS');
    expect(await screen.findByRole('button', { name: 'Pay €7.25' })).toBeEnabled();
    expect(screen.getByText('+€1.50')).toBeInTheDocument();
  });

  it('pays for the full experience alone by default', async () => {
    const redirect = open('MAX_CARDS');
    await userEvent.click(await screen.findByRole('button', { name: 'Pay €4.99' }));

    await waitFor(() =>
      expect(redirect).toHaveBeenCalledWith('https://checkout.stripe.test/c/pay/cs_test_1'),
    );
    expect(api.createCheckoutSession).toHaveBeenCalledWith('grant-token', {
      giftId: gift.id,
      includeCustomSlug: false,
      customSlug: undefined,
      successUrl: `${window.location.origin}/create/${gift.id}/success`,
      cancelUrl: `${window.location.origin}/create/${gift.id}`,
    });
  });

  it('sends the creator back to where they were if they give up the payment', async () => {
    const redirect = open('PRO_FEATURES', vi.fn(), { cancelPath: `/create/${gift.id}/preview` });
    await userEvent.click(await screen.findByRole('button', { name: 'Pay €4.99' }));
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(api.createCheckoutSession).toHaveBeenCalledWith(
      'grant-token',
      expect.objectContaining({
        successUrl: `${window.location.origin}/create/${gift.id}/success`,
        cancelUrl: `${window.location.origin}/create/${gift.id}/preview`,
      }),
    );
  });

  it('lists the PRO features the gift uses when publishing needs the payment', async () => {
    open('PRO_FEATURES', vi.fn(), {
      gift: giftView({ proFeatures: ['EXTRA_CARDS', 'VOICE_NOTE', 'PREMIUM_REVEAL'] }),
    });
    const used = within(screen.getByRole('list', { name: 'PRO features in this gift' }));
    expect(used.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'More than 3 cards',
      'Voice note',
      'Premium reveal',
    ]);
  });

  it('highlights that a paid gift never expires, unlike a free one', () => {
    open('WATERMARK');
    expect(screen.getByText('An eternal memory: it never expires')).toBeInTheDocument();
    expect(
      screen.getByText('Free gifts are deleted 1 year after they are published.'),
    ).toBeInTheDocument();
  });

  it('gives the custom link a random ending of four characters from the start', async () => {
    open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));

    // Pre-filled from the recipient's name.
    expect(nameInput()).toHaveValue('ana');
    const ending = (endingInput() as HTMLInputElement).value;
    expect(ending).toMatch(/^[a-z0-9]{4}$/);
    expect(screen.getByTestId('slug-preview')).toHaveTextContent(`kardoo.me/for/ana-${ending}`);

    await userEvent.click(screen.getByRole('button', { name: 'New random ending' }));
    expect((endingInput() as HTMLInputElement).value).toMatch(/^[a-z0-9]{4}$/);
    expect((endingInput() as HTMLInputElement).value).not.toBe(ending);
  });

  it('previews the custom link live and adds it to the total', async () => {
    const redirect = open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));
    await typeLink('Te quiero, Ana', 'X9-K2!');

    expect(nameInput()).toHaveValue('te-quiero-ana');
    expect(endingInput()).toHaveValue('x9k2');
    expect(screen.getByTestId('slug-preview')).toHaveTextContent(
      'kardoo.me/for/te-quiero-ana-x9k2',
    );
    expect(await screen.findByText('Available')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pay €6.98' }));
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(api.createCheckoutSession).toHaveBeenCalledWith(
      'grant-token',
      expect.objectContaining({ includeCustomSlug: true, customSlug: 'te-quiero-ana-x9k2' }),
    );
  });

  it('does not accept a link without an ending of at least four characters', async () => {
    open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));

    for (const ending of ['', 'x9k']) {
      await typeLink('laura', ending);
      expect(screen.getByText(/an ending of at least 4/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();
    }
    expect(api.checkSlug).not.toHaveBeenCalledWith('laura', expect.anything());

    // The last word of the name does not stand in for the ending.
    await typeLink('te quiero mama', '');
    expect(screen.getByTestId('slug-preview')).toHaveTextContent('kardoo.me/for/te-quiero-mama');
    expect(screen.getByText(/an ending of at least 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();

    await typeLink('laura', 'mama');
    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeEnabled();
  });

  it('offers the free alternatives of a taken link, and takes the one that is picked', async () => {
    const redirect = open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));

    await typeLink('taken link', '2026');
    expect(await screen.findByText(/Not available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();
    for (const suggestion of ['taken-link-k7m2', 'taken-link-p4x9', 'taken-link-z3b8']) {
      expect(screen.getByRole('button', { name: suggestion })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole('button', { name: 'taken-link-p4x9' }));
    expect(nameInput()).toHaveValue('taken-link');
    expect(endingInput()).toHaveValue('p4x9');
    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'taken-link-k7m2' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pay €6.98' }));
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(api.createCheckoutSession).toHaveBeenCalledWith(
      'grant-token',
      expect.objectContaining({ customSlug: 'taken-link-p4x9' }),
    );
  });

  it('does not let the creator pay for a link that is taken or invalid', async () => {
    open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));

    await typeLink('taken link', '2026');
    expect(await screen.findByText(/Not available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();

    // A reserved name stays refused whatever its ending.
    await typeLink('create', 'x9k2');
    expect(screen.getByText(/3 to 40/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();

    // Unticking the extra makes the plain upgrade payable again.
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Pay €4.99' })).toBeEnabled();
  });

  it('reports a failed checkout and does not redirect', async () => {
    vi.mocked(api.createCheckoutSession).mockRejectedValue(new Error('network'));
    const redirect = open('MAX_CARDS');
    await userEvent.click(await screen.findByRole('button', { name: 'Pay €4.99' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't start the payment");
    expect(redirect).not.toHaveBeenCalled();
  });
});
