import { z } from 'zod';

/** Compose files pass an unset optional variable as an empty string: read it as not set. */
const emptyAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Public origin of the web app. Used for CORS, redirect validation and QR targets. */
    WEB_ORIGIN: z.url({ protocol: /^https?$/ }).transform((value) => value.replace(/\/+$/, '')),
    /** Signs the short-lived grants that the media, QR and payment endpoints accept. */
    GRANT_SIGNING_SECRET: z.string().min(32),
    /** Public base URL under which uploaded media is served (R2 public bucket or CDN). */
    MEDIA_PUBLIC_URL: z
      .url({ protocol: /^https?$/ })
      .transform((value) => value.replace(/\/+$/, '')),
    /** S3-compatible object storage: Cloudflare R2 in production, S3Mock locally. */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_REGION: z.string().min(1).default('auto'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, 'Expected a Stripe secret key'),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
    /** One-time price of the full experience. Amounts live in Stripe, never in code. */
    STRIPE_PRICE_ID_PREMIUM: z.string().startsWith('price_'),
    /** One-time price of the custom link order bump. */
    STRIPE_PRICE_ID_CUSTOM_SLUG: z.string().startsWith('price_'),
    /** Points the Stripe SDK at a local stand-in. Only for automated tests; refused in production. */
    STRIPE_API_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    /** Requests one client (IP) may make per minute, over all endpoints. */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(240),
    /** Gifts one client (IP) may start per hour. */
    GIFT_CREATION_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
    /**
     * Links that lead to no gift which one client (IP) may open in ten minutes before every lookup
     * is refused for the rest of that time. Keeps links from being found by trying addresses.
     */
    LINK_LOOKUP_MISS_LIMIT: z.coerce.number().int().positive().default(30),
    /** Link availability checks one client (IP) may make in ten minutes. */
    SLUG_CHECK_LIMIT: z.coerce.number().int().positive().default(60),
    /** Reverse proxies in front of the API, so that the client IP is read from X-Forwarded-For. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    EVENT_BUS_DRIVER: z.enum(['memory', 'redis']).default('memory'),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
    /** Whether this instance runs the daily jobs (expired gifts, anniversary email). */
    SCHEDULED_JOBS: z
      .enum(['on', 'off'])
      .default('on')
      .transform((value) => value === 'on'),
    /** `log` sends nothing (and the anniversary email waits); `resend` sends through Resend. */
    MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
    RESEND_API_KEY: emptyAsUnset(z.string().startsWith('re_').optional()),
    /** Sender of every email, e.g. `kardoo.me <hello@kardoo.me>`. Its domain must be verified. */
    MAIL_FROM: emptyAsUnset(z.string().trim().min(3).max(200).optional()),
  })
  .superRefine((env, ctx) => {
    const deployed = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
    if (deployed && env.GRANT_SIGNING_SECRET.includes('change-me')) {
      ctx.addIssue({
        code: 'custom',
        path: ['GRANT_SIGNING_SECRET'],
        message: 'GRANT_SIGNING_SECRET still has the example value',
      });
    }
    if (env.NODE_ENV === 'production' && !/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_SECRET_KEY'],
        message: 'Production needs a live Stripe key',
      });
    }
    if (deployed && env.STRIPE_API_BASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['STRIPE_API_BASE_URL'],
        message: 'STRIPE_API_BASE_URL is a test-only setting',
      });
    }
    if (env.EVENT_BUS_DRIVER === 'redis' && !env.REDIS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when EVENT_BUS_DRIVER=redis',
      });
    }
    for (const name of ['RESEND_API_KEY', 'MAIL_FROM'] as const) {
      if (env.MAIL_DRIVER === 'resend' && !env[name]) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required when MAIL_DRIVER=resend`,
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class InvalidEnvError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidEnvError';
  }
}

/** Validates the environment once at startup. The app must not boot with an invalid configuration. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
