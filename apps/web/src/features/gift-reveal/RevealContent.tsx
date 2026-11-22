import type { Reveal } from '@remember-me/shared-types';

/** The surprise itself, once uncovered. Shared by every reveal template. */
export function RevealContent({
  reveal,
  tone = 'dark',
}: {
  reveal: Reveal;
  tone?: 'dark' | 'light';
}) {
  const soft = tone === 'dark' ? 'text-ink-soft' : 'text-paper/70';
  return (
    <div className="text-center" data-testid="reveal-content">
      {reveal.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- user media from object storage
        <img
          src={reveal.imageUrl}
          alt=""
          className="mx-auto mb-4 aspect-[4/3] w-full rounded-2xl object-cover"
        />
      )}
      <p className="font-display text-[1.9rem] leading-[1.1] tracking-tight text-balance">
        {reveal.headline}
      </p>
      {reveal.detail && (
        <p className="text-ember mt-2 text-sm font-semibold tracking-wide uppercase">
          {reveal.detail}
        </p>
      )}
      {reveal.message && (
        <p className={`mt-3 leading-relaxed whitespace-pre-line ${soft}`}>{reveal.message}</p>
      )}
    </div>
  );
}
