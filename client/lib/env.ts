/**
 * App environment — reads EXPO_PUBLIC_* vars when Metro injects them,
 * otherwise falls back to sensible local defaults.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

const env = typeof process !== 'undefined' ? process.env ?? {} : {};

export const API_URL = (
  env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080'
).replace(/\/$/, '');

export const GOOGLE_WEB_CLIENT_ID = env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const GOOGLE_IOS_CLIENT_ID = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
export const GOOGLE_ANDROID_CLIENT_ID = env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '';
