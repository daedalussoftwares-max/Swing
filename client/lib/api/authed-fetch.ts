import { ApiError, apiFetch } from '@/lib/api/client';
import { getFreshAccessToken, refreshAccessToken } from '@/lib/api/session';

export async function authedFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) {
    throw new ApiError('UNAUTHORIZED', 'Please sign in again.', { path });
  }
  try {
    return await apiFetch<T>(path, withAuth(init, accessToken));
  } catch (e) {
    // Token revoked or clock skew — refresh once and retry.
    if (e instanceof ApiError && e.httpStatus === 401) {
      const next = await refreshAccessToken();
      if (next) return apiFetch<T>(path, withAuth(init, next));
    }
    throw e;
  }
}

function withAuth(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}
