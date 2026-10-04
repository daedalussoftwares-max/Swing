/**
 * Access-token lifecycle. Access tokens are short-lived (15m), so anything
 * long-running (chat, WebSocket) must refresh transparently instead of
 * failing with 401 once the token ages out.
 */

import * as authApi from '@/lib/api/auth-api';
import { ApiError } from '@/lib/api/client';
import { clearTokens, readTokens, writeTokens } from '@/lib/api/token-storage';

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

let inflight: Promise<string | null> | null = null;

/**
 * Exchanges the refresh token for a new pair. Single-flight: refresh
 * tokens rotate, so two concurrent refreshes would invalidate each other.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { refreshToken } = await readTokens();
      if (!refreshToken) return null;
      const session = await authApi.refresh(refreshToken);
      await writeTokens(session.accessToken, session.refreshToken);
      return session.accessToken;
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === 'INVALID_TOKEN' || e.httpStatus === 401)
      ) {
        await clearTokens();
        for (const fn of expiredListeners) fn();
      }
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Returns an access token that is valid for at least another minute. */
export async function getFreshAccessToken(): Promise<string | null> {
  const { accessToken } = await readTokens();
  if (!accessToken) return null;
  const exp = jwtExpiryMs(accessToken);
  if (exp != null && exp - Date.now() < EXPIRY_SKEW_MS) {
    return (await refreshAccessToken()) ?? null;
  }
  return accessToken;
}
