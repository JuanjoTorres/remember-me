import type { PhotoTextPayload } from '@remember-me/shared-types';

export function PhotoTextCard({ payload }: { payload: PhotoTextPayload }) {
  if (!payload.imageUrl) {
    return (
      <p className="font-display px-2 text-center text-[2rem] leading-[1.15] tracking-tight text-balance whitespace-pre-line">
        {payload.text}
      </p>
    );
  }
  return (
    <figure className="w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- user media from object storage */}
      <img
        src={payload.imageUrl}
        alt=""
        className="max-h-[62dvh] w-full rounded-3xl object-cover shadow-2xl"
      />
      {payload.text && (
        <figcaption className="mt-5 px-1 text-center text-lg leading-snug text-balance whitespace-pre-line">
          {payload.text}
        </figcaption>
      )}
    </figure>
  );
}
