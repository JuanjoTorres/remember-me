import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
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
