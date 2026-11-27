'use client';

import { useEffect, useRef, useState } from 'react';
import { TextArea, TextInput } from '@/features/shared/ui/Field';

interface SavedInputProps {
  value: string;
  onSave: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  /**
   * `registerField` of the editor. With it the editor can save this field before leaving the
   * page when it shows a text that is not saved: still focused, after a save that failed, or
   * typed back while a save was on its way.
   */
  register?: (saveIfChanged: () => boolean) => () => void;
}

/** A text control that keeps its own draft and saves when the creator leaves it, if it changed. */
export function SavedInput({
  value,
  onSave,
  maxLength,
  placeholder,
  multiline = false,
  disabled = false,
  register,
}: SavedInputProps) {
  const [draft, setDraft] = useState(value);
  // Adopt a value saved elsewhere (another field's response) without a re-mount.
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  // Whether the creator has typed here since the saved value last matched the text. Typing the
  // saved text back does not clear it: a save of the earlier text may still be on its way.
  const [dirty, setDirty] = useState(false);
  if (seen !== value) {
    setSeen(value);
    if (value === draft.trim()) setDirty(false);
    // The creator's text wins over an older value coming back: while they are typing here, and
    // while what they typed is still to be saved (an answer to an earlier save, or to another
    // field's, must not put the old text back).
    else if (!focused && !dirty) setDraft(value);
  }

  // The text this field last sent to be saved; its answer may still be on its way.
  const sent = useRef<string | null>(null);
  /** Saves the text if it is not the saved one; tells whether it sent it. */
  const saveIfChanged = (): boolean => {
    const text = draft.trim();
    if (disabled || text === value) return false;
    sent.current = text;
    onSave(text);
    return true;
  };
  const latest = useRef(saveIfChanged);
  const leftBehind = useRef(false);
  useEffect(() => {
    latest.current = saveIfChanged;
    leftBehind.current = !focused && dirty && draft.trim() !== sent.current;
  });
  // An answer that leaves the field showing a text the creator typed and that was never sent (they
  // typed the old text back while the save of another one was on its way): save what it shows.
  useEffect(() => {
    if (leftBehind.current) latest.current();
    // The save this field was waiting for has answered.
    else if (sent.current === value) sent.current = null;
  }, [value]);
  useEffect(() => register?.(() => latest.current()), [register]);

  const props = {
    value: draft,
    maxLength,
    placeholder,
    disabled,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      setDirty(true);
    },
    onFocus: () => {
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
      // Back on the saved text with no save of this field on its way: nothing is left to save,
      // so a value changed elsewhere later is adopted instead of being overwritten.
      if (!saveIfChanged() && draft.trim() === value && sent.current === null) setDirty(false);
    },
  };
  return multiline ? <TextArea {...props} /> : <TextInput {...props} />;
}
