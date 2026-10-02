/**
 * App configuration from client/.env (inlined at build time via babel-plugin-inline-dotenv).
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

const env = typeof process !== 'undefined' ? process.env ?? {} : {};

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return '';
}

export const API_URL = firstNonEmpty(
  env.SWING_API_URL,
  env.EXPO_PUBLIC_API_URL,
  'http://localhost:8080',
).replace(/\/$/, '');

export const GOOGLE_WEB_CLIENT_ID = firstNonEmpty(
  env.SWING_GOOGLE_WEB_CLIENT_ID,
  env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
);

export const GOOGLE_IOS_CLIENT_ID = firstNonEmpty(
  env.SWING_GOOGLE_IOS_CLIENT_ID,
  env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
);

export const GOOGLE_ANDROID_CLIENT_ID = firstNonEmpty(
  env.SWING_GOOGLE_ANDROID_CLIENT_ID,
  env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
);
