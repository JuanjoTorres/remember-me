import type { PublicGift } from '@remember-me/shared-types';
import { cache } from 'react';
import { getServerEnv } from '@/config/env';

/**
 * Loads a published gift on the server, pod to pod through `INTERNAL_API_URL`. Returns null when
 * there is no published gift behind the slug. Deduplicated within one request.
 */
export const getPublicGift = cache(async (slug: string): Promise<PublicGift | null> => {
  const url = `${getServerEnv().INTERNAL_API_URL}/public/gifts/${encodeURIComponent(slug)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Loading gift failed with status ${response.status}`);
  return (await response.json()) as PublicGift;
});
