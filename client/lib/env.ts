/**
 * App configuration from client/.env (loaded via react-native-dotenv at build time).
 */
import {
  EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  SWING_API_URL,
  SWING_GOOGLE_ANDROID_CLIENT_ID,
  SWING_GOOGLE_IOS_CLIENT_ID,
  SWING_GOOGLE_WEB_CLIENT_ID,
} from '@env';

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return '';
}

export const API_URL = firstNonEmpty(SWING_API_URL, EXPO_PUBLIC_API_URL, 'http://localhost:8080').replace(
  /\/$/,
  '',
);

export const GOOGLE_WEB_CLIENT_ID = firstNonEmpty(
  SWING_GOOGLE_WEB_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
);

export const GOOGLE_IOS_CLIENT_ID = firstNonEmpty(
  SWING_GOOGLE_IOS_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
);

export const GOOGLE_ANDROID_CLIENT_ID = firstNonEmpty(
  SWING_GOOGLE_ANDROID_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
);
