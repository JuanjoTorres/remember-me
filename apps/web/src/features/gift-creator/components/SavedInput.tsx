'use client';

import { useState } from 'react';
import { TextArea, TextInput } from '@/features/shared/ui/Field';

interface SavedInputProps {
  value: string;
  onSave: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  multiline?: boolean;
}

/** A text control that keeps its own draft and saves when the creator leaves it, if it changed. */
export function SavedInput({
  value,
  onSave,
  maxLength,
  placeholder,
  multiline = false,
}: SavedInputProps) {
  const [draft, setDraft] = useState(value);
  // Adopt a value saved elsewhere (another field's response) without a re-mount.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }

  const props = {
    value: draft,
    maxLength,
    placeholder,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => {
      if (draft.trim() !== value) onSave(draft.trim());
    },
  };
  return multiline ? <TextArea {...props} /> : <TextInput {...props} />;
}
