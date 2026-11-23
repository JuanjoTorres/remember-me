'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { type ReactNode, useEffect, useId, useRef } from 'react';

const FOCUSABLE = 'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])';

/** Open sheets, bottom to top. Only the top one reacts to the keyboard. */
const openSheets: symbol[] = [];

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel: string;
  children: ReactNode;
}

/** Mobile-first bottom sheet: slides up over the page, closes on backdrop tap or Escape. */
export function Sheet({ open, onClose, title, closeLabel, children }: SheetProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Kept in a ref so that a new `onClose` function on every render does not restart the effect.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const self = Symbol('sheet');
    openSheets.push(self);
    const opener = document.activeElement as HTMLElement | null;
    // Move focus into the dialog, keep Tab inside it, and give focus back on close.
    const focusPanel = requestAnimationFrame(() => panel.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (openSheets.at(-1) !== self) return;
      if (event.key === 'Escape') return close.current();
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => !element.hasAttribute('disabled'),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return event.preventDefault();
      const active = document.activeElement;
      const outside = !panel.current.contains(active) || active === panel.current;
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      openSheets.splice(openSheets.indexOf(self), 1);
      cancelAnimationFrame(focusPanel);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.button
            type="button"
            aria-label={closeLabel}
            className="bg-night/50 absolute inset-0 cursor-default"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="bg-paper relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl px-5 outline-none pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
          >
            <div aria-hidden className="bg-ink/15 mx-auto mb-4 h-1 w-10 rounded-full" />
            <h2 id={titleId} className="font-display text-2xl leading-tight tracking-tight">
              {title}
            </h2>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
