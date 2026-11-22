import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { giftView, renderApp } from '../../../test/render';
import * as api from './api';
import { PremiumUpgradeSheet } from './PremiumUpgradeSheet';
import type { UpgradeReason } from './upgrade-triggers';

vi.mock('./api');

const gift = giftView();
const withGrant = <T,>(call: (grant: string) => Promise<T>) => call(gift.grant);

function open(reason: UpgradeReason, redirect = vi.fn()) {
  renderApp(
    <PremiumUpgradeSheet
      reason={reason}
      onClose={() => undefined}
      gift={gift}
      withGrant={withGrant}
      redirect={redirect}
    />,
  );
  return redirect;
}

describe('PremiumUpgradeSheet', () => {
  beforeEach(() => {
    vi.mocked(api.getPrices).mockResolvedValue({
      premium: { amount: 499, currency: 'eur' },
      customSlug: { amount: 199, currency: 'eur' },
    });
    vi.mocked(api.getSlugAvailability).mockImplementation(async (slug) => ({
      slug,
      available: slug !== 'taken-link',
    }));
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
    ['WATERMARK', /remove “Created with remember.me”/],
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

  it('previews the custom link live and adds it to the total', async () => {
    const redirect = open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));

    const input = screen.getByRole('textbox', { name: 'Custom link' });
    // Pre-filled from the recipient's name.
    expect(input).toHaveValue('ana');
    await userEvent.clear(input);
    await userEvent.type(input, 'Te quiero, Ana');

    expect(input).toHaveValue('te-quiero-ana');
    expect(screen.getByTestId('slug-preview')).toHaveTextContent('remember.me/for/te-quiero-ana');
    expect(await screen.findByText('Available')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pay €6.98' }));
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(api.createCheckoutSession).toHaveBeenCalledWith(
      'grant-token',
      expect.objectContaining({ includeCustomSlug: true, customSlug: 'te-quiero-ana' }),
    );
  });

  it('does not let the creator pay for a link that is taken or invalid', async () => {
    open('MAX_CARDS');
    await screen.findByRole('button', { name: 'Pay €4.99' });
    await userEvent.click(screen.getByRole('checkbox'));
    const input = screen.getByRole('textbox', { name: 'Custom link' });

    await userEvent.clear(input);
    await userEvent.type(input, 'taken link');
    expect(await screen.findByText(/Not available/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay €6.98' })).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'ab');
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
