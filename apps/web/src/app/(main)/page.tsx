import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BrandMark } from '@/features/shared/ui/BrandMark';

export default async function HomePage() {
  const t = await getTranslations('home');
  const steps = [
    { title: t('step1Title'), text: t('step1Text') },
    { title: t('step2Title'), text: t('step2Text') },
    { title: t('step3Title'), text: t('step3Text') },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-10 pb-8">
      <p className="text-ink font-display text-xl tracking-tight">
        <BrandMark />
      </p>

      <section className="mt-14">
        <p className="text-ember text-sm font-medium">{t('tagline')}</p>
        <h1 className="font-display mt-3 text-[2.6rem] leading-[1.05] tracking-tight text-balance">
          {t('title')}
        </h1>
        <p className="text-ink-soft mt-5 text-base leading-relaxed text-pretty">{t('subtitle')}</p>
      </section>

      <ol className="border-line mt-10 space-y-5 border-t pt-8">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span className="font-display text-ember w-5 shrink-0 text-lg tabular-nums">
              {index + 1}
            </span>
            <div>
              <h2 className="font-medium">{step.title}</h2>
              <p className="text-ink-soft mt-0.5 text-sm leading-relaxed">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-auto pt-10">
        <Link
          href="/create"
          className="bg-ember active:bg-ember-deep block rounded-full px-6 py-4 text-center text-base font-semibold text-white"
        >
          {t('cta')}
        </Link>
        <p className="text-ink-soft mt-3 text-center text-sm">{t('free')}</p>
        <p className="mt-6 text-center text-xs">
          <Link href="/privacy" className="text-ink-soft underline underline-offset-4">
            {t('privacy')}
          </Link>
        </p>
      </div>
    </main>
  );
}
