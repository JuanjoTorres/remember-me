import type { Viewport } from 'next';
import { getLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import '../globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#120b1a',
};

/**
 * Root layout of the QR route, separate from the rest of the site: full screen, dark, and with no
 * client providers, so that a recipient's phone downloads only what the experience needs.
 */
export default async function RecipientLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={await getLocale()}>
      <body className="bg-night h-dvh overflow-hidden overscroll-none">{children}</body>
    </html>
  );
}
