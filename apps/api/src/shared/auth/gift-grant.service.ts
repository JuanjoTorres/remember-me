import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PlanSchema } from '@remember-me/shared-types';
import { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../http/app-error.js';

const GrantClaimsSchema = z.object({
  giftId: z.uuid(),
  slug: z.string(),
  plan: PlanSchema,
  published: z.boolean(),
  /** Expiry, in seconds since the epoch. */
  exp: z.number().int(),
});
export type GiftGrantClaims = z.infer<typeof GrantClaimsSchema>;

export const GRANT_TTL_SECONDS = 30 * 60;

/**
 * A grant is a signed snapshot of what its holder may do with one gift. The gifts module issues it
 * to whoever proves edit access; every other module trusts the signature instead of calling gifts.
 */
@Injectable()
export class GiftGrantService {
  private readonly secret: string;

  constructor(@Inject(ENV) env: Env) {
    this.secret = env.GRANT_SIGNING_SECRET;
  }

  issue(
    claims: Omit<GiftGrantClaims, 'exp'>,
    now = new Date(),
  ): { grant: string; expiresAt: Date } {
    const exp = Math.floor(now.getTime() / 1000) + GRANT_TTL_SECONDS;
    const body = Buffer.from(JSON.stringify({ ...claims, exp })).toString('base64url');
    return { grant: `${body}.${this.sign(body)}`, expiresAt: new Date(exp * 1000) };
  }

  verify(grant: string, now = new Date()): GiftGrantClaims {
    const [body, signature, ...rest] = grant.split('.');
    if (!body || !signature || rest.length > 0 || !this.matches(body, signature)) {
      throw new AppError('UNAUTHORIZED', 'Invalid grant');
    }
    let json: unknown;
    try {
      json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new AppError('UNAUTHORIZED', 'Invalid grant');
    }
    const claims = GrantClaimsSchema.safeParse(json);
    if (!claims.success) throw new AppError('UNAUTHORIZED', 'Invalid grant');
    if (claims.data.exp * 1000 <= now.getTime())
      throw new AppError('UNAUTHORIZED', 'Grant expired');
    return claims.data;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  private matches(body: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(body));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
