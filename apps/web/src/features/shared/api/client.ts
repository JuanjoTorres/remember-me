import type { ApiError, ErrorCode } from '@remember-me/shared-types';
import { apiBaseUrl } from '@/config/env';

/** A failed API call, carrying the stable error code the UI reacts to. */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function isApiError(error: unknown, code?: ErrorCode): error is ApiClientError {
  return error instanceof ApiClientError && (code === undefined || error.code === code);
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body, or a FormData for uploads. */
  body?: unknown;
  /** Secret edit token of a gift (gifts endpoints). */
  editToken?: string;
  /** Short-lived gift grant (media, QR and payment endpoints). */
  grant?: string;
  signal?: AbortSignal;
  cache?: RequestCache;
}

async function send(path: string, request: ApiRequest): Promise<Response> {
  const headers: Record<string, string> = {};
  if (request.editToken) headers['x-edit-token'] = request.editToken;
  if (request.grant) headers['Authorization'] = `Bearer ${request.grant}`;
  const isForm = typeof FormData !== 'undefined' && request.body instanceof FormData;
  if (request.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: request.method ?? 'GET',
      headers,
      body:
        request.body === undefined
          ? undefined
          : isForm
            ? (request.body as FormData)
            : JSON.stringify(request.body),
      signal: request.signal,
      cache: request.cache ?? 'no-store',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'INTERNAL', 'Network error');
  }
  if (response.ok) return response;

  const body = (await response.json().catch(() => null)) as Partial<ApiError> | null;
  throw new ApiClientError(
    response.status,
    body?.code ?? 'INTERNAL',
    body?.message ?? response.statusText,
    body?.details,
  );
}

export async function apiJson<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const response = await send(path, request);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function apiBlob(path: string, request: ApiRequest = {}): Promise<Blob> {
  return (await send(path, request)).blob();
}
