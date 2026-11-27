import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { giftView, photoCards, renderApp } from '../../../../test/render';
import * as creatorApi from '../api';
import { SharePanel } from './SharePanel';

vi.mock('../api');

/** A paid, published gift whose custom link is still to be chosen. */
const gift = giftView({
  status: 'PUBLISHED',
  plan: 'PREMIUM',
  cards: photoCards(1),
  publishedAt: '2030-01-01T10:00:00.000Z',
  customSlugPending: true,
});

function renderPanel(onChangeSlug: (name: string) => Promise<boolean>) {
  renderApp(
    <SharePanel
      gift={gift}
      editToken="secret-token"
      withGrant={(call) => call(gift.grant)}
      onUpgrade={() => undefined}
      onChangeSlug={onChangeSlug}
    />,
  );
  return {
    name: screen.getByRole('textbox', { name: 'Custom link' }),
    save: screen.getByRole('button', { name: 'Use this link' }),
  };
}

describe('SharePanel: choosing another name for a paid link', () => {
  beforeEach(() => {
    vi.mocked(creatorApi.downloadQr).mockResolvedValue(new Blob(['png']));
  });

  it.each([
    ['is refused', () => Promise.resolve(false)],
    ['fails without an answer, as with no connection', () => Promise.reject(new Error('offline'))],
  ])('says so and lets the creator try again when the change %s', async (_case, outcome) => {
    const onChangeSlug = vi.fn(outcome);
    const { name, save } = renderPanel(onChangeSlug);
    await userEvent.type(name, 'nuestro-viaje');
    await userEvent.click(save);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That name could not be saved. Try again.',
    );
    expect(onChangeSlug).toHaveBeenCalledExactlyOnceWith('nuestro-viaje');
    // Not left busy: the same name can be sent again.
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onChangeSlug).toHaveBeenCalledTimes(2);
  });

  it('takes the error away as soon as the creator types another name', async () => {
    const { name, save } = renderPanel(() => Promise.reject(new Error('offline')));
    await userEvent.type(name, 'nuestro-viaje');
    await userEvent.click(save);
    expect(await screen.findByRole('alert')).toBeVisible();

    await userEvent.type(name, '-2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
