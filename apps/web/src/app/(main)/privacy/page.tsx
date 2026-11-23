import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('privacy');
  return { title: `${t('title')} · remember.me` };
}

const SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;

export default async function PrivacyPage() {
  const t = await getTranslations('privacy');
  return (
    <main className="mx-auto max-w-md px-6 pt-10 pb-16">
      <Link href="/" className="font-display text-xl tracking-tight">
        remember<span className="text-ember">.me</span>
      </Link>
      <h1 className="font-display mt-10 text-4xl tracking-tight">{t('title')}</h1>
      <p className="text-ink-soft mt-2 text-sm">{t('updated')}</p>
      <p className="mt-6 leading-relaxed">{t('intro')}</p>
      {SECTIONS.map((section) => (
        <section key={section} className="mt-7">
          <h2 className="font-display text-xl tracking-tight">{t(`${section}Title`)}</h2>
          <p className="text-ink-soft mt-2 leading-relaxed">{t(`${section}Text`)}</p>
        </section>
      ))}
      <Link href="/" className="mt-10 inline-block text-sm underline underline-offset-4">
        {t('back')}
      </Link>
    </main>
  );
}
