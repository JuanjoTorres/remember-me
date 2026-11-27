import type { Metadata } from 'next';
import { DRAFT_TTL_DAYS, EDIT_GRACE_HOURS, FREE_GIFT_TTL_YEARS } from '@remember-me/shared-types';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BRAND_NAME } from '@/features/shared/brand';
import { BrandMark } from '@/features/shared/ui/BrandMark';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('privacy');
  return { title: `${t('title')} · ${BRAND_NAME}` };
}

const SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;

export default async function PrivacyPage() {
  const t = await getTranslations('privacy');
  return (
    <main className="mx-auto max-w-md px-6 pt-10 pb-16">
      <Link href="/" className="font-display text-xl tracking-tight">
        <BrandMark />
      </Link>
      <h1 className="font-display mt-10 text-4xl tracking-tight">{t('title')}</h1>
      <p className="text-ink-soft mt-2 text-sm">{t('updated')}</p>
      <p className="mt-6 leading-relaxed">{t('intro', { brand: BRAND_NAME })}</p>
      {SECTIONS.map((section) => (
        <section key={section} className="mt-7">
          <h2 className="font-display text-xl tracking-tight">{t(`${section}Title`)}</h2>
          <p className="text-ink-soft mt-2 leading-relaxed">
            {/* How long things are kept comes from the shared rules, never from the text itself. */}
            {t(`${section}Text`, {
              draftDays: DRAFT_TTL_DAYS,
              freeYears: FREE_GIFT_TTL_YEARS,
              graceHours: EDIT_GRACE_HOURS,
            })}
          </p>
        </section>
      ))}
      <Link href="/" className="mt-10 inline-block text-sm underline underline-offset-4">
        {t('back', { brand: BRAND_NAME })}
      </Link>
    </main>
  );
}
