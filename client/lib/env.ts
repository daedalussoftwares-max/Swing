/**
 * App configuration from client/.env (inlined at build time via babel-plugin-inline-dotenv).
 * Use `process.env.VAR` directly — dynamic `process.env` objects are not inlined in release/APK bundles.
 */

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return '';
}

export const API_URL = firstNonEmpty(
  process.env.SWING_API_URL,
  process.env.EXPO_PUBLIC_API_URL,
  'http://localhost:8080',
).replace(/\/$/, '');

export const GOOGLE_WEB_CLIENT_ID = firstNonEmpty(
  process.env.SWING_GOOGLE_WEB_CLIENT_ID,
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
);

export const GOOGLE_IOS_CLIENT_ID = firstNonEmpty(
  process.env.SWING_GOOGLE_IOS_CLIENT_ID,
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
);

export const GOOGLE_ANDROID_CLIENT_ID = firstNonEmpty(
  process.env.SWING_GOOGLE_ANDROID_CLIENT_ID,
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
);

function envTruthy(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Verbose client failure logs + on-screen debug footnotes (set SWING_DEBUG_ERRORS=true). */
export const DEBUG_ERRORS_ENABLED =
  envTruthy(process.env.SWING_DEBUG_ERRORS) ||
  envTruthy(process.env.EXPO_PUBLIC_SWING_DEBUG_ERRORS);
