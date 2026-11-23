'use client';

// This route has no translation provider on purpose (it ships as little as possible), so the two
// languages of this one screen live here.
const TEXT = {
  en: {
    title: "We couldn't open the gift",
    text: 'Check your connection and try again. Your gift is still there.',
    retry: 'Try again',
  },
  es: {
    title: 'No hemos podido abrir el regalo',
    text: 'Revisa tu conexión e inténtalo de nuevo. Tu regalo sigue ahí.',
    retry: 'Reintentar',
  },
};

export default function GiftError({ reset }: { error: Error; reset: () => void }) {
  const language =
    typeof document !== 'undefined' && document.documentElement.lang === 'es' ? 'es' : 'en';
  const t = TEXT[language];
  return (
    <main className="text-paper mx-auto flex h-dvh max-w-md flex-col items-center justify-center px-8 text-center">
      <h1 className="font-display text-4xl leading-tight tracking-tight">{t.title}</h1>
      <p className="text-paper/70 mt-4 leading-relaxed">{t.text}</p>
      <button
        type="button"
        onClick={reset}
        className="bg-paper text-ink mt-8 rounded-full px-7 py-3 text-sm font-semibold"
      >
        {t.retry}
      </button>
    </main>
  );
}
