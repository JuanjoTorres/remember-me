import type { PublicGift, RevealTemplate } from '@remember-me/shared-types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import confetti from 'canvas-confetti';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ExperienceLabels, GiftExperience } from './GiftExperience';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const labels: ExperienceLabels = {
  coverEyebrow: 'A gift for you',
  coverFor: 'For Sarah',
  coverFrom: 'From Juan',
  coverStart: 'Tap to begin',
  next: 'Next',
  previous: 'Back',
  play: 'Play voice note',
  pause: 'Pause voice note',
  triviaWrong: 'Not quite. Try again.',
  triviaRight: "That's it!",
  continue: 'Continue',
  replay: 'Watch again',
  watermark: 'Created with kardoo.me',
  reveal: {
    BASIC: 'Tap to open',
    SCRATCH_CARD: 'Scratch here',
    TICKET: 'Tear off to see where',
    GIFT_BOX: 'Tap the box to open it',
    revealNow: 'Show me the surprise',
    ticketTitle: 'Boarding pass',
    ticketPassenger: 'Passenger',
  },
};

function gift(template: RevealTemplate, overrides: Partial<PublicGift> = {}): PublicGift {
  return {
    slug: 'sarah-x9k2bd',
    locale: 'en',
    recipientName: 'Sarah',
    senderName: 'Juan',
    watermark: true,
    cards: [
      {
        id: 'c1',
        position: 0,
        type: 'PHOTO_TEXT',
        payload: { text: 'Remember this day?', imageUrl: null },
      },
      {
        id: 'c2',
        position: 1,
        type: 'TRIVIA',
        payload: {
          question: 'Where did we meet?',
          options: ['Porto', 'Lisbon'],
          correctIndex: 1,
          successMessage: 'You remembered!',
        },
      },
    ],
    reveal: {
      template,
      headline: 'We are going to Lisbon!',
      message: 'Pack light.',
      detail: '14 March',
      imageUrl: null,
    },
    ...overrides,
  };
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }));

async function goToReveal() {
  await next();
  await screen.findByText('Remember this day?');
  await next();
  // Steps cross-fade, so the next one appears a moment later.
  await userEvent.click(await screen.findByRole('button', { name: 'Lisbon' }));
  await userEvent.click(await screen.findByRole('button', { name: /Continue/ }));
}

describe('GiftExperience', () => {
  beforeEach(() => {
    vi.mocked(confetti).mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  it('walks from the cover through the cards', async () => {
    render(<GiftExperience gift={gift('BASIC')} labels={labels} />);
    expect(screen.getByRole('heading', { name: 'For Sarah' })).toBeInTheDocument();
    expect(screen.getByText('From Juan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await next();
    expect(await screen.findByText('Remember this day?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { name: 'For Sarah' })).toBeInTheDocument();
  });

  it('holds the recipient on the trivia until the right answer', async () => {
    render(<GiftExperience gift={gift('BASIC')} labels={labels} />);
    await next();
    await screen.findByText('Remember this day?');
    await next();
    expect(await screen.findByText('Where did we meet?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Porto' }));
    expect(screen.getByRole('status')).toHaveTextContent('Not quite. Try again.');
    expect(screen.getByRole('button', { name: 'Porto' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Lisbon' }));
    expect(screen.getByRole('status')).toHaveTextContent('You remembered!');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('reveals the surprise of a free gift with confetti and the watermark', async () => {
    render(<GiftExperience gift={gift('BASIC')} labels={labels} />);
    await goToReveal();
    expect(screen.queryByText('We are going to Lisbon!')).not.toBeInTheDocument();
    expect(screen.queryByTestId('watermark')).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Tap to open' }));
    expect(await screen.findByText('We are going to Lisbon!')).toBeInTheDocument();
    expect(screen.getByText('14 March')).toBeInTheDocument();
    expect(screen.getByText('Pack light.')).toBeInTheDocument();
    expect(confetti).toHaveBeenCalled();
    expect(await screen.findByTestId('watermark')).toHaveTextContent('Created with kardoo.me');
  });

  it('shows no watermark on a premium gift', async () => {
    render(<GiftExperience gift={gift('BASIC', { watermark: false })} labels={labels} />);
    await goToReveal();
    await userEvent.click(await screen.findByRole('button', { name: 'Tap to open' }));
    expect(await screen.findByRole('button', { name: 'Watch again' })).toBeInTheDocument();
    expect(screen.queryByTestId('watermark')).not.toBeInTheDocument();
  });

  it('opens the gift box on the third tap', async () => {
    render(<GiftExperience gift={gift('GIFT_BOX')} labels={labels} />);
    await goToReveal();
    for (const taps of [1, 2]) {
      await userEvent.click(await screen.findByRole('button', { name: 'Tap the box to open it' }));
      expect(screen.getByText(new RegExp(`${taps}/3`))).toBeInTheDocument();
      expect(screen.queryByTestId('reveal-content')).not.toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Tap the box to open it' }));
    expect(await screen.findByText('We are going to Lisbon!')).toBeInTheDocument();
    expect(confetti).toHaveBeenCalled();
  });

  it('tears the boarding pass with a tap and names the passenger', async () => {
    render(<GiftExperience gift={gift('TICKET')} labels={labels} />);
    await goToReveal();
    expect(await screen.findByText('Boarding pass')).toBeInTheDocument();
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Tear off to see where/ }));
    expect(await screen.findByText('We are going to Lisbon!')).toBeInTheDocument();
  });

  it('offers a way to reveal the scratch card without the gesture', async () => {
    render(<GiftExperience gift={gift('SCRATCH_CARD')} labels={labels} />);
    await goToReveal();
    expect(await screen.findByTestId('scratch-surface')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show me the surprise' }));
    expect(confetti).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Watch again' })).toBeInTheDocument();
  });

  it('skips the confetti for people who prefer reduced motion', async () => {
    // Let the delayed second burst of an earlier celebration pass before counting.
    await new Promise((resolve) => setTimeout(resolve, 300));
    vi.mocked(confetti).mockClear();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<GiftExperience gift={gift('BASIC')} labels={labels} />);
    await goToReveal();
    await userEvent.click(await screen.findByRole('button', { name: 'Tap to open' }));
    expect(await screen.findByText('We are going to Lisbon!')).toBeInTheDocument();
    expect(confetti).not.toHaveBeenCalled();
  });

  it('starts over from the cover', async () => {
    render(<GiftExperience gift={gift('BASIC')} labels={labels} />);
    await goToReveal();
    await userEvent.click(await screen.findByRole('button', { name: 'Tap to open' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Watch again' }));
    expect(await screen.findByRole('heading', { name: 'For Sarah' })).toBeInTheDocument();
  });

  it('is the main landmark of the recipient page, but not when embedded in the preview', () => {
    const { unmount } = render(<GiftExperience gift={gift('BASIC')} labels={labels} />);
    expect(screen.getByRole('main')).toHaveClass('h-dvh');
    unmount();

    // The preview page already has its own main landmark and gives the experience its height.
    render(<GiftExperience embedded gift={gift('BASIC')} labels={labels} />);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'For Sarah' })).toBeInTheDocument();
  });
});
