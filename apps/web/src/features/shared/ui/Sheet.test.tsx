import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

function Stack() {
  const [form, setForm] = useState(false);
  const [upgrade, setUpgrade] = useState(false);
  return (
    <>
      <button onClick={() => setForm(true)}>Open form</button>
      <Sheet open={form} onClose={() => setForm(false)} title="Card" closeLabel="Close card">
        <input aria-label="Text" />
        <button onClick={() => setUpgrade(true)}>Upgrade</button>
      </Sheet>
      <Sheet
        open={upgrade}
        onClose={() => setUpgrade(false)}
        title="Full experience"
        closeLabel="Close upgrade"
      >
        <button>Pay</button>
        <button>Later</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not take focus away from a field the user already reached inside the dialog', async () => {
    // The sheet focuses its panel on the next animation frame. Hold that frame back until the user
    // is already in the field, which is the order a slow device (or CI runner) produces.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    render(<Stack />);
    await userEvent.click(screen.getByRole('button', { name: 'Open form' }));
    const field = await screen.findByRole('textbox', { name: 'Text' });
    await userEvent.click(field);

    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((callback) => callback(0));

    expect(field).toHaveFocus();
    await userEvent.keyboard('Half written');
    expect(field).toHaveValue('Half written');
  });

  it('moves focus into the dialog and gives it back on close', async () => {
    render(<Stack />);
    const opener = screen.getByRole('button', { name: 'Open form' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Card' });
    await expect.poll(() => dialog.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard('{Escape}');
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    render(<Stack />);
    await userEvent.click(screen.getByRole('button', { name: 'Open form' }));
    const dialog = await screen.findByRole('dialog', { name: 'Card' });
    for (let i = 0; i < 6; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('lets only the top sheet react to Escape, so the form underneath survives', async () => {
    render(<Stack />);
    await userEvent.click(screen.getByRole('button', { name: 'Open form' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Text' }), 'Half written');
    await userEvent.click(screen.getByRole('button', { name: 'Upgrade' }));
    const upgrade = await screen.findByRole('dialog', { name: 'Full experience' });

    await userEvent.tab();
    expect(upgrade.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => screen.queryByRole('dialog', { name: 'Full experience' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Card' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Text' })).toHaveValue('Half written');
  });
});
