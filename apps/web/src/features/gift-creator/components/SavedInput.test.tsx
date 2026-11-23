import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SavedInput } from './SavedInput';

describe('SavedInput', () => {
  it('saves on leaving the field, only when the text changed', async () => {
    const onSave = vi.fn();
    render(<SavedInput value="Sara" maxLength={40} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await userEvent.click(input);
    await userEvent.tab();
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.type(input, 'h ');
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Sarah');
  });

  it('keeps what is being typed when an older value comes back from the server', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<SavedInput value="" maxLength={40} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'Sar');
    await userEvent.tab();
    // The creator is back in the field before the first save answered.
    await userEvent.type(input, 'ah');
    rerender(<SavedInput value="Sar" maxLength={40} onSave={onSave} />);
    expect(input).toHaveValue('Sarah');
    await userEvent.tab();
    expect(onSave).toHaveBeenLastCalledWith('Sarah');
  });

  it('adopts a new value when the field is not being edited', () => {
    const { rerender } = render(<SavedInput value="Sara" maxLength={40} onSave={vi.fn()} />);
    rerender(<SavedInput value="Marta" maxLength={40} onSave={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('Marta');
  });
});
