import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const CONTROL =
  'w-full rounded-2xl border border-line bg-white px-4 py-3 text-base text-ink placeholder:text-ink-soft/60 focus:border-ember focus:outline-none';

interface LabelProps {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, hint, children }: LabelProps) {
  return (
    <label className="block">
      <span className="text-ink-soft mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-ink-soft mt-1.5 block text-sm">{hint}</span>}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} className={`${CONTROL} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea rows={3} {...props} className={`${CONTROL} resize-none ${props.className ?? ''}`} />
  );
}
