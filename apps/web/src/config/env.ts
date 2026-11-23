import { z } from 'zod';

const httpUrl = z.url({ protocol: /^https?$/ }).transform((value) => value.replace(/\/+$/, ''));

const ClientEnvSchema = z.object({
  /** API base URL as seen from the visitor's browser. */
  NEXT_PUBLIC_API_URL: httpUrl,
});

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** API base URL for server-side rendering, pod to pod. */
  INTERNAL_API_URL: httpUrl,
});

export type ClientEnv = z.infer<typeof ClientEnvSchema>;
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

function parse<T>(schema: z.ZodType<T>, source: unknown): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  return parse(ClientEnvSchema, source);
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parse(ServerEnvSchema, source);
}

/**
 * NEXT_PUBLIC_* values are inlined at build time, so each one must be referenced literally.
 * Importing this module with an invalid value fails the build and the server start.
 */
export const clientEnv: ClientEnv = parseClientEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

let cachedServerEnv: ServerEnv | undefined;

/** Server-only configuration. Validated at startup from `instrumentation.ts`. */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('getServerEnv() must not be called in the browser');
  }
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

/** Base URL of the API for the current runtime: internal on the server, public in the browser. */
export function apiBaseUrl(): string {
  return typeof window === 'undefined'
    ? getServerEnv().INTERNAL_API_URL
    : clientEnv.NEXT_PUBLIC_API_URL;
}
