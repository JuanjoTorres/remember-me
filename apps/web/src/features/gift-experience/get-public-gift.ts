import type { PublicGift } from '@remember-me/shared-types';
import { headers } from 'next/headers';
import { cache } from 'react';
import { getServerEnv } from '@/config/env';

/** The API refuses this visitor for a while: too many links that lead to no gift were opened. */
export const REFUSED = 'refused';

/** What the address of a gift page carries: its code and, for a custom link, the name after it. */
export interface GiftLink {
  code: string;
  name?: string;
}

/**
 * Loads a published gift on the server, pod to pod through `INTERNAL_API_URL`. Returns null when
 * there is no published gift behind the link, and `REFUSED` when the API will not say (it never
 * tells a refused visitor whether a link exists). Deduplicated within one request.
 */
export const getPublicGift = cache((link: GiftLink) => load(link.code, link.name));

/** `cache` compares arguments one by one, so the link is taken apart before it gets here. */
const load = cache(
  async (code: string, name: string | undefined): Promise<PublicGift | null | typeof REFUSED> => {
    const path =
      name === undefined
        ? encodeURIComponent(code)
        : `${encodeURIComponent(code)}/for/${encodeURIComponent(name)}`;
    const url = `${getServerEnv().INTERNAL_API_URL}/public/gifts/${path}`;
    // Pass the visitor's address on, so that the API rate limits each visitor and not this server as
    // a whole. The reverse proxy in front of the web app sets the header; the API is not reachable
    // from outside without going through that proxy.
    const visitor = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
    const response = await fetch(url, {
      cache: 'no-store',
      headers: visitor ? { 'X-Forwarded-For': visitor } : undefined,
    });
    if (response.status === 404) return null;
    if (response.status === 429) return REFUSED;
    if (!response.ok) throw new Error(`Loading gift failed with status ${response.status}`);
    return (await response.json()) as PublicGift;
  },
);
