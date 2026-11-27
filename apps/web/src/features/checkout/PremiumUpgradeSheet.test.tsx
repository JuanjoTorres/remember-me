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
/** Types the name of a custom link. */
async function typeName(name: string) {
  await userEvent.clear(nameInput());
  await userEvent.type(nameInput(), name);
}

describe('PremiumUpgradeSheet', () => {
  beforeEach(() => {
    vi.mocked(api.getPrices).mockResolvedValue({
      premium: { amount: 499, currency: 'eur' },
      customSlug: { amount: 199, currency: 'eur' },
    });
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
      screen.getByText('Free gifts are deleted 3 months after they are published.'),
    ).toBeInTheDocument();
  });

  it('asks only for the name of the custom link and shows where the code will go', async () => {
    open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));

    // Pre-filled from the recipient's name; the code is not the creator's to choose or to see yet.
    expect(nameInput()).toHaveValue('ana');
    expect(screen.getByTestId('slug-preview')).toHaveTextContent('kardoo.me/····/for/ana');
    expect(within(screen.getByRole('dialog')).getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText(/A code of 4 characters goes in front/)).toBeInTheDocument();
  });

  it('previews the custom link live, adds it to the total and sends only the name', async () => {
    const redirect = open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));
    await typeName('Te quiero, Ana');

    expect(nameInput()).toHaveValue('te-quiero-ana');
    expect(screen.getByTestId('slug-preview')).toHaveTextContent(
      'kardoo.me/····/for/te-quiero-ana',
    );
    expect(screen.getByRole('status')).toHaveTextContent('This name can be yours');

    await userEvent.click(screen.getByRole('button', { name: 'Pay €6.98' }));
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(api.createCheckoutSession).toHaveBeenCalledWith(
      'grant-token',
      expect.objectContaining({ includeCustomSlug: true, customSlug: 'te-quiero-ana' }),
    );
  });

  it('does not let the creator pay for a name that is missing, too short or reserved', async () => {
    open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeEnabled();

    await userEvent.clear(nameInput());
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();
    for (const name of ['ab', 'create']) {
      await typeName(name);
      expect(screen.getByText(/3 to 40/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();
    }

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
