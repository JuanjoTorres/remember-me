import { z } from 'zod';

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
    EVENT_BUS_DRIVER: z.enum(['memory', 'redis']).default('memory'),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EVENT_BUS_DRIVER === 'redis' && !env.REDIS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when EVENT_BUS_DRIVER=redis',
      });
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
