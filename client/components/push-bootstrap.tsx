/**
 * <PushBootstrap /> — wires Firebase Cloud Messaging into the app.
 *
 *  - After sign-in: asks for notification permission, gets the FCM token,
 *    registers it with POST /v1/devices and keeps it fresh (onTokenRefresh).
 *  - Notification taps (background + cold start) deep-link into the chat /
 *    plane once the navigator is ready and the user is signed in.
 *  - Foreground messages are ignored on purpose: the server only pushes when
 *    the app is backgrounded; in-app banners come from the WebSocket.
 *
 * Renders nothing. A no-op until Firebase config files are added.
 */
import { useCallback, useEffect, useRef } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import { registerPushDevice } from '@/lib/api/devices-api';
import { useAuth } from '@/lib/auth-context';
import {
  getFirebaseMessaging,
  rememberToken,
  type RemoteMessage,
} from '@/lib/push/firebase';
import { pushTargetFromData, type PushTarget } from '@/lib/push/navigate';
import { navigationRef } from '@/lib/router';

const AUTH_ROUTES = new Set(['Splash', 'Signup', 'Signin', 'ProfileSetup']);

// Android delivers data to a headless JS task when a push arrives while the
// app is in the background. Notification payloads are displayed by the OS,
// so there is nothing to do — but registering a handler silences RNFB's
// "No background message handler" warning. Must run at module load.
(() => {
  const fm = getFirebaseMessaging();
  if (!fm) return;
  try {
    fm.m.setBackgroundMessageHandler(fm.messaging, async () => {});
  } catch {
    /* ignore */
  }
})();

let initialNotificationConsumed = false;

async function ensurePermission(): Promise<boolean> {
  const fm = getFirebaseMessaging();
  if (!fm) return false;
  if (Platform.OS === 'android') {
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }
  const status = await fm.m.requestPermission(fm.messaging, {
    alert: true,
    badge: true,
    sound: true,
  });
  return (
    status === fm.m.AuthorizationStatus.AUTHORIZED ||
    status === fm.m.AuthorizationStatus.PROVISIONAL
  );
}

async function registerToken(token: string) {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  await registerPushDevice(token, platform);
  await rememberToken(token);
}

function log(msg: string, e?: unknown) {
  if (!__DEV__) return;
  console.info(`[push] ${msg}${e ? `: ${(e as Error)?.message ?? e}` : ''}`);
}

export function PushBootstrap() {
  const { status, user } = useAuth();
  const userId = status === 'signed-in' ? user.id : null;
  const statusRef = useRef(status);
  statusRef.current = status;
  const pendingRef = useRef<PushTarget | null>(null);

  // ── Token registration ───────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const fm = getFirebaseMessaging();
    if (!fm) return;

    let cancelled = false;
    let unsubscribeRefresh: (() => void) | undefined;

    (async () => {
      try {
        const granted = await ensurePermission();
        if (cancelled || !granted) {
          if (!granted) log('notification permission not granted');
          return;
        }
        if (Platform.OS === 'ios' && !fm.m.isDeviceRegisteredForRemoteMessages(fm.messaging)) {
          await fm.m.registerDeviceForRemoteMessages(fm.messaging);
        }
        const token = await fm.m.getToken(fm.messaging);
        if (cancelled || !token) return;
        await registerToken(token);
        log('device registered for push');
      } catch (e) {
        log('push registration failed', e);
      }
    })();

    try {
      unsubscribeRefresh = fm.m.onTokenRefresh(fm.messaging, (token) => {
        if (!token || statusRef.current !== 'signed-in') return;
        registerToken(token).catch((e) => log('token refresh register failed', e));
      });
    } catch (e) {
      log('onTokenRefresh unavailable', e);
    }

    return () => {
      cancelled = true;
      unsubscribeRefresh?.();
    };
  }, [userId]);

  // ── Notification taps ────────────────────────────────────────────
  const flushPending = useCallback(() => {
    const target = pendingRef.current;
    if (!target) return;
    if (statusRef.current !== 'signed-in' || !navigationRef.isReady()) return;
    const current = navigationRef.getCurrentRoute()?.name;
    // Wait for AuthGate to move us out of Splash/ProfileSetup, otherwise
    // its reset() would wipe the screen we push here.
    if (!current || AUTH_ROUTES.has(current)) return;
    pendingRef.current = null;
    try {
      if (target.name === 'Chat') {
        navigationRef.navigate('Chat', target.params);
      } else if (target.name === 'PlaneDetail') {
        navigationRef.navigate('PlaneDetail', target.params);
      } else {
        navigationRef.navigate('Notifications');
      }
    } catch (e) {
      log('navigation from push failed', e);
    }
  }, []);

  const handleOpened = useCallback(
    (message: RemoteMessage | null) => {
      const target = pushTargetFromData(message?.data);
      if (!target) return;
      pendingRef.current = target;
      flushPending();
    },
    [flushPending],
  );

  useEffect(() => {
    const fm = getFirebaseMessaging();
    if (!fm) return;
    let unsubscribeOpened: (() => void) | undefined;
    try {
      unsubscribeOpened = fm.m.onNotificationOpenedApp(fm.messaging, handleOpened);
      if (!initialNotificationConsumed) {
        initialNotificationConsumed = true;
        fm.m
          .getInitialNotification(fm.messaging)
          .then(handleOpened)
          .catch((e) => log('getInitialNotification failed', e));
      }
    } catch (e) {
      log('notification tap listeners unavailable', e);
    }
    return () => unsubscribeOpened?.();
  }, [handleOpened]);

  // Retry a pending deep link whenever navigation or auth state changes.
  useEffect(() => {
    flushPending();
    return navigationRef.addListener('state', flushPending);
  }, [status, flushPending]);

  return null;
}
