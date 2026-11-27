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

  it('saves the text typed back while the save of another one was on its way', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<SavedInput value="Juan" maxLength={40} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, ' Carlos');
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Juan Carlos');
    // Before that save answers, the creator puts the old name back and leaves the field.
    await userEvent.clear(input);
    await userEvent.type(input, 'Juan');
    await userEvent.tab();
    expect(onSave).toHaveBeenCalledOnce();

    // The first save answers: the server has a name the field does not show.
    rerender(<SavedInput value="Juan Carlos" maxLength={40} onSave={onSave} />);
    expect(input).toHaveValue('Juan');
    expect(onSave).toHaveBeenLastCalledWith('Juan');
    expect(onSave).toHaveBeenCalledTimes(2);

    rerender(<SavedInput value="Juan" maxLength={40} onSave={onSave} />);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('does not send again a text whose save is still on its way', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<SavedInput value="Juan" maxLength={40} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, ' Carlos');
    await userEvent.tab();
    // The answer to an earlier change arrives first, with a value that is not what was typed.
    rerender(<SavedInput value="Juanito" maxLength={40} onSave={onSave} />);
    expect(input).toHaveValue('Juan Carlos');
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Juan Carlos');
  });

  it('adopts a value changed elsewhere once the creator put the saved text back', async () => {
    const onSave = vi.fn();
    const { rerender } = render(<SavedInput value="Juan" maxLength={40} onSave={onSave} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'x{Backspace}');
    await userEvent.tab();
    // The same gift was edited in another tab.
    rerender(<SavedInput value="Tom" maxLength={40} onSave={onSave} />);
    expect(input).toHaveValue('Tom');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('adopts a new value when the field is not being edited', () => {
    const { rerender } = render(<SavedInput value="Sara" maxLength={40} onSave={vi.fn()} />);
    rerender(<SavedInput value="Marta" maxLength={40} onSave={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveValue('Marta');
  });
});
