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

  /** Saves the text if it is not the saved one; tells whether it sent it. */
  const saveIfChanged = (): boolean => {
    const text = draft.trim();
    if (disabled || text === value) return false;
    onSave(text);
    return true;
  };
  const latest = useRef(saveIfChanged);
  useEffect(() => {
    latest.current = saveIfChanged;
  });
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
      saveIfChanged();
    },
  };
  return multiline ? <TextArea {...props} /> : <TextInput {...props} />;
}
