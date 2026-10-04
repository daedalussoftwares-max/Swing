/**
 * Access-token lifecycle. Access tokens are short-lived (15m), so anything
 * long-running (chat, WebSocket) must refresh transparently instead of
 * failing with 401 once the token ages out.
 */

import * as authApi from '@/lib/api/auth-api';
import { ApiError } from '@/lib/api/client';
import type { AuthSessionResponse } from '@/lib/api/auth-types';
import {
  clearTokens,
  readTokens,
  tokenGeneration,
  writeTokens,
} from '@/lib/api/token-storage';

/** Refresh this long before `exp` so in-flight requests don't race expiry. */
const EXPIRY_SKEW_MS = 60_000;

type Listener = () => void;
const expiredListeners = new Set<Listener>();

/** Fires when the refresh token is rejected and the user must sign in again. */
export function onSessionExpired(fn: Listener) {
  expiredListeners.add(fn);
  return () => {
    expiredListeners.delete(fn);
  };
}

const B64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64url → ASCII (JWT payloads are plain JSON, no unicode needed). */
function decodeBase64Url(input: string): string {
  const s = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function jwtExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(decodeBase64Url(part)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

let inflight: Promise<AuthSessionResponse | null> | null = null;

/**
 * Exchanges the refresh token for a new session. Single-flight: refresh
 * tokens rotate, so concurrent refreshes must share one request.
 *
 * Resolves `null` ONLY when the server says the session is over
 * (INVALID_TOKEN) — tokens are cleared and listeners notified. Network /
 * server errors THROW instead: a flaky connection must never log anyone out.
 */
export function refreshSession(): Promise<AuthSessionResponse | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const gen = tokenGeneration();
    try {
      const { refreshToken } = await readTokens();
      if (!refreshToken) return null;
      const session = await authApi.refresh(refreshToken);
      // Signed out while we were waiting? Don't bring the tokens back.
      if (gen !== tokenGeneration()) return null;
      await writeTokens(session.accessToken, session.refreshToken);
      return session;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_TOKEN') {
        if (gen === tokenGeneration()) {
          await clearTokens();
          for (const fn of expiredListeners) fn();
        }
        return null;
      }
      throw e;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** New access token; `null` when the session has ended. Throws on network errors. */
export async function refreshAccessToken(): Promise<string | null> {
  const session = await refreshSession();
  return session?.accessToken ?? null;
}

/**
 * Returns an access token that is valid for at least another minute.
 * `null` = not signed in. If a needed refresh fails transiently, the old
 * token is returned while it is still technically valid, otherwise the
 * network error is thrown (the request fails; the session survives).
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const { accessToken } = await readTokens();
  if (!accessToken) return null;
  const exp = jwtExpiryMs(accessToken);
  if (exp == null || exp - Date.now() >= EXPIRY_SKEW_MS) return accessToken;
  try {
    return await refreshAccessToken();
  } catch (e) {
    if (exp > Date.now()) return accessToken;
    throw e;
  }
}
