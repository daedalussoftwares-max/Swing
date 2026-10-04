import { authedFetch } from '@/lib/api/authed-fetch';
import { apiFetch } from '@/lib/api/client';
import type {
  AuthSessionResponse,
  AuthUser,
  MeResponse,
  ProfilePatchBody,
  UsernameAvailableResponse,
} from '@/lib/api/auth-types';

export type {
  AuthSessionResponse,
  AuthUser,
  MeResponse,
  ProfilePatchBody,
} from '@/lib/api/auth-types';

export async function register(
  email: string,
  password: string,
): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function login(
  email: string,
  password: string,
): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function loginWithGoogle(
  idToken: string,
): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/v1/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  });
}

export async function refresh(refreshToken: string): Promise<AuthSessionResponse> {
  return apiFetch<AuthSessionResponse>('/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

export async function logout(refreshToken: string): Promise<void> {
  await apiFetch<void>('/v1/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}

/** GET /v1/me with the current session (auto-refresh + 401 retry). */
export async function getMe(): Promise<AuthUser> {
  const res = await authedFetch<MeResponse>('/v1/me');
  return res.user;
}

export async function updateProfile(patch: ProfilePatchBody): Promise<AuthUser> {
  const res = await authedFetch<MeResponse>('/v1/me', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.user;
}

export async function deleteAccount(): Promise<void> {
  await authedFetch<void>('/v1/me', { method: 'DELETE' });
}

export async function checkUsernameAvailable(
  username: string,
): Promise<boolean> {
  const norm = username.trim().toLowerCase();
  const res = await apiFetch<UsernameAvailableResponse>(
    `/v1/usernames/${encodeURIComponent(norm)}/available`,
  );
  return res.available;
}
