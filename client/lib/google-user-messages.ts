/**
 * User-facing Google sign-in copy only. Technical details go to console in __DEV__.
 */

import { Platform } from 'react-native';

export const GOOGLE_SIGNIN_UNAVAILABLE =
  'Google sign-in is not available right now. Use email and password.';

export const GOOGLE_SIGNIN_FAILED =
  'Could not sign in with Google. Try again or use email and password.';

export const GOOGLE_SIGNIN_BLOCKED =
  'Google sign-in was blocked. Use email and password for now.';

export const GOOGLE_SIGNIN_CANCELLED = 'Sign-in cancelled.';

/** Short message when OAuth clients are missing in .env (no file paths in UI). */
export function googleSetupUserMessage(
  webClientId: string,
  iosClientId: string,
  androidClientId: string,
): string | null {
  if (!webClientId) {
    return GOOGLE_SIGNIN_UNAVAILABLE;
  }
  if (Platform.OS === 'ios' && !iosClientId) {
    return GOOGLE_SIGNIN_UNAVAILABLE;
  }
  if (Platform.OS === 'android' && !androidClientId) {
    return GOOGLE_SIGNIN_UNAVAILABLE;
  }
  return null;
}

/** Dev-only hint logged to Metro — never shown in the app UI. */
export function googleSetupDevHint(
  webClientId: string,
  iosClientId: string,
  androidClientId: string,
): string | null {
  if (!webClientId) {
    return 'Missing SWING_GOOGLE_WEB_CLIENT_ID in client/.env';
  }
  if (Platform.OS === 'ios' && !iosClientId) {
    return 'Missing SWING_GOOGLE_IOS_CLIENT_ID — use bundle com.rahulsaw.swing (see GOOGLE-AUTH-SETUP.md)';
  }
  if (Platform.OS === 'android' && !androidClientId) {
    return 'Missing SWING_GOOGLE_ANDROID_CLIENT_ID — see GOOGLE-AUTH-SETUP.md';
  }
  return null;
}

export class GoogleSignInError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string, devDetail?: string) {
    super(userMessage);
    this.name = 'GoogleSignInError';
    this.userMessage = userMessage;
    if (__DEV__ && devDetail) {
      console.warn('[Google OAuth]', devDetail);
    }
  }
}

/** Map native / OAuth failures to safe UI copy. */
export function humanizeGoogleFailure(
  resultType: string,
  rawDetail?: string,
): GoogleSignInError {
  const lower = (rawDetail ?? '').toLowerCase();

  if (resultType === 'cancel' || resultType === 'dismiss') {
    return new GoogleSignInError(GOOGLE_SIGNIN_CANCELLED);
  }

  if (
    lower.includes('access blocked') ||
    lower.includes('access_denied') ||
    lower.includes('blocked') ||
    lower.includes('authorization error')
  ) {
    return new GoogleSignInError(
      GOOGLE_SIGNIN_BLOCKED,
      rawDetail ?? 'access blocked — add Test users in Google Cloud OAuth consent screen',
    );
  }

  if (
    lower.includes('authorization grant') ||
    lower.includes('invalid_grant') ||
    lower.includes('issued to another client') ||
    lower.includes('redirection uri')
  ) {
    return new GoogleSignInError(
      GOOGLE_SIGNIN_FAILED,
      rawDetail ??
        'token exchange failed — use iOS OAuth client with bundle com.rahulsaw.swing',
    );
  }

  if (
    lower.includes('oauth 2.0 policy') ||
    lower.includes('invalid_request') ||
    lower.includes('redirect_uri') ||
    lower.includes('invalid_client')
  ) {
    return new GoogleSignInError(
      GOOGLE_SIGNIN_FAILED,
      rawDetail ??
        'redirect_uri mismatch — create iOS OAuth client for bundle com.rahulsaw.swing',
    );
  }

  return new GoogleSignInError(
    GOOGLE_SIGNIN_FAILED,
    rawDetail || `prompt result: ${resultType}`,
  );
}

export function humanizeGoogleError(err: unknown, fallback = GOOGLE_SIGNIN_FAILED): string {
  if (err instanceof GoogleSignInError) {
    return err.userMessage;
  }
  return fallback;
}

/** User closed the Google sheet — no inline error needed. */
export function isGoogleSignInCancelled(err: unknown): boolean {
  return (
    err instanceof GoogleSignInError &&
    err.userMessage === GOOGLE_SIGNIN_CANCELLED
  );
}
