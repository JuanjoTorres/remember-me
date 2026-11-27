import type { ErrorCode } from '@remember-me/shared-types';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  PREMIUM_REQUIRED: 402,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  GIFT_INCOMPLETE: 422,
  GIFT_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** An expected failure with a stable code the clients can act on. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export function codeForStatus(status: number): ErrorCode {
  const match = (Object.entries(STATUS_BY_CODE) as [ErrorCode, number][]).find(
    ([, value]) => value === status,
  );
  if (match) return match[0];
  return status >= 500 ? 'INTERNAL' : 'VALIDATION_ERROR';
}
