import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ember text-white active:bg-ember-deep',
  secondary: 'border border-ink/15 bg-white text-ink active:bg-paper-deep',
  ghost: 'text-ink-soft active:bg-paper-deep',
  danger: 'text-ember-deep active:bg-paper-deep',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  busy = false,
  block = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition-opacity disabled:opacity-50 ${
        block ? 'w-full' : ''
      } ${VARIANTS[variant]} ${className}`}
    >
      {busy && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
