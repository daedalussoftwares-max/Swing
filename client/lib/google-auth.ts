/**
 * Google Sign-In via @react-native-google-signin/google-signin.
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { useCallback, useMemo, useRef } from 'react';

import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from '@/lib/env';
import {
  GoogleSignInError,
  googleSetupDevHint,
  googleSetupUserMessage,
  humanizeGoogleFailure,
} from '@/lib/google-user-messages';

const webClientId = GOOGLE_WEB_CLIENT_ID;
const iosClientId = GOOGLE_IOS_CLIENT_ID;
const androidClientId = GOOGLE_ANDROID_CLIENT_ID;

if (webClientId) {
  GoogleSignin.configure({
    webClientId,
    iosClientId: iosClientId || undefined,
  });
}

export function useGoogleSignIn() {
  const setupError = googleSetupUserMessage(
    webClientId,
    iosClientId,
    androidClientId,
  );
  const signingIn = useRef(false);

  const signIn = useCallback(async (): Promise<string> => {
    if (signingIn.current) {
      throw new GoogleSignInError('Could not sign in with Google. Try again.');
    }
    if (setupError) {
      throw new GoogleSignInError(
        setupError,
        googleSetupDevHint(webClientId, iosClientId, androidClientId) ?? undefined,
      );
    }

    signingIn.current = true;
    try {
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken;
      if (!idToken) {
        throw new GoogleSignInError(
          'Could not sign in with Google. Try again or use email and password.',
          'missing idToken',
        );
      }
      return idToken;
    } catch (err) {
      throw humanizeGoogleFailure('error', (err as Error)?.message);
    } finally {
      signingIn.current = false;
    }
  }, [setupError]);

  return useMemo(
    () => ({
      signIn,
      ready: !setupError,
      setupError,
    }),
    [signIn, setupError],
  );
}
