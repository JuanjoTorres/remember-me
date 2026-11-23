import type { PublicGift } from '@remember-me/shared-types';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getServerEnv } from '@/config/env';

/**
 * Loads a published gift on the server, pod to pod through `INTERNAL_API_URL`. Returns null when
 * there is no published gift behind the slug. Deduplicated within one request.
 */
export const getPublicGift = cache(async (slug: string): Promise<PublicGift | null> => {
  const url = `${getServerEnv().INTERNAL_API_URL}/public/gifts/${encodeURIComponent(slug)}`;
  // Pass the visitor's address on, so that the API rate limits each visitor and not this server as
  // a whole. The reverse proxy in front of the web app sets the header; the API is not reachable
  // from outside without going through that proxy.
  const visitor = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
  const response = await fetch(url, {
    cache: 'no-store',
    headers: visitor ? { 'X-Forwarded-For': visitor } : undefined,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Loading gift failed with status ${response.status}`);
  return (await response.json()) as PublicGift;
});
