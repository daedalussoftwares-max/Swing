/**
 * HTTP client for the Swing Go API.
 */

import { logFailure } from '@/lib/debug-logger';
import { API_URL } from '@/lib/env';
import { newRequestId } from '@/lib/request-id';
import { codeFromHttpStatus, messageForApiCode } from '@/lib/api/user-messages';

export class ApiError extends Error {
  readonly code: string;
  readonly requestId?: string;
  readonly httpStatus?: number;
  readonly path?: string;

  constructor(
    code: string,
    message: string,
    opts?: { requestId?: string; httpStatus?: number; path?: string },
  ) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
    this.requestId = opts?.requestId;
    this.httpStatus = opts?.httpStatus;
    this.path = opts?.path;
  }
}

type ErrorBody = {
  error?: { code?: string; message?: string; request_id?: string };
};

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const requestId = newRequestId();
  headers.set('X-Request-Id', requestId);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (e) {
    const err = new ApiError(
      'NETWORK',
      `Cannot reach the server at ${API_URL}. Check Wi‑Fi and that the API is running on your Mac.`,
      {
        requestId,
        path,
      },
    );
    logFailure({
      kind: 'api',
      code: err.code,
      message: err.message,
      requestId,
      path,
    });
    throw err;
  }

  const responseRequestId = res.headers.get('X-Request-Id') ?? requestId;

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
    const errBody = data as ErrorBody;
    const code = errBody?.error?.code ?? codeFromHttpStatus(res.status);
    const message = messageForApiCode(code, errBody?.error?.message);
    const rid = errBody?.error?.request_id ?? responseRequestId;
    const err = new ApiError(code, message, {
      requestId: rid,
      httpStatus: res.status,
      path,
    });
    logFailure({
      kind: 'api',
      code: err.code,
      message: err.message,
      requestId: rid,
      path,
      status: res.status,
    });
    throw err;
  }

  return data as T;
}

export function getApiBaseUrl(): string {
  return API_URL;
}
