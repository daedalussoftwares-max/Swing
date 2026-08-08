/**
 * HTTP client for the Swing Go API.
 */

import { API_URL } from '@/lib/env';
import { codeFromHttpStatus, messageForApiCode } from '@/lib/api/user-messages';

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

type ErrorBody = {
  error?: { code?: string; message?: string };
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('NETWORK', 'Cannot reach the server. Check your connection and API URL.');
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = data as ErrorBody;
    const code = err?.error?.code ?? codeFromHttpStatus(res.status);
    const message = messageForApiCode(code, err?.error?.message);
    throw new ApiError(code, message);
  }

  return data as T;
}

export function getApiBaseUrl(): string {
  return API_URL;
}
