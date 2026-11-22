import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function GiftNotFound() {
  const t = await getTranslations('experience');
  return (
    <main className="text-paper mx-auto flex h-dvh max-w-md flex-col items-center justify-center px-8 text-center">
      <h1 className="font-display text-4xl leading-tight tracking-tight">{t('notFoundTitle')}</h1>
      <p className="text-paper/70 mt-4 leading-relaxed">{t('notFoundText')}</p>
      <Link href="/" className="text-gold mt-8 text-sm font-semibold underline underline-offset-4">
        {t('notFoundHome')}
      </Link>
    </main>
  );
}
