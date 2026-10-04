/**
 * Guarded access to @react-native-firebase/messaging.
 *
 * Push stays OFF until the Firebase config files are added
 * (android/app/google-services.json, ios/swing/GoogleService-Info.plist —
 * see docs/PUSH-SETUP.md). Every call here must be safe when Firebase is
 * not configured or the native module isn't linked yet: no throws, no
 * red screens, just `null` / no-ops.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

type MessagingModule = typeof import('@react-native-firebase/messaging');
type AppModule = typeof import('@react-native-firebase/app');
export type Messaging = import('@react-native-firebase/messaging').Messaging;
export type RemoteMessage = import('@react-native-firebase/messaging').RemoteMessage;

const LAST_TOKEN_KEY = 'swing/v1/push/last-token';

let modules: { app: AppModule; messaging: MessagingModule } | null | undefined;
let warned = false;

function loadModules() {
  if (modules !== undefined) return modules;
  try {
    modules = {
      app: require('@react-native-firebase/app') as AppModule,
      messaging: require('@react-native-firebase/messaging') as MessagingModule,
    };
  } catch (e) {
    modules = null;
    logOnce('firebase native modules unavailable', e);
  }
  return modules;
}

function logOnce(msg: string, e?: unknown) {
  if (warned || !__DEV__) return;
  warned = true;
  console.info(`[push] ${msg}${e ? `: ${(e as Error)?.message ?? e}` : ''}`);
}

/** The messaging module + instance, or null when Firebase isn't configured. */
export function getFirebaseMessaging(): { m: MessagingModule; messaging: Messaging } | null {
  const mods = loadModules();
  if (!mods) return null;
  try {
    // No default app => google-services.json / GoogleService-Info.plist missing.
    if (mods.app.getApps().length === 0) {
      logOnce('Firebase not configured (no default app), push disabled');
      return null;
    }
    return { m: mods.messaging, messaging: mods.messaging.getMessaging() };
  } catch (e) {
    logOnce('Firebase unavailable, push disabled', e);
    return null;
  }
}

// ── Last registered token (needed to unregister on sign-out) ───────────

let lastToken: string | null = null;

export async function rememberToken(token: string | null): Promise<void> {
  lastToken = token;
  try {
    if (token) await AsyncStorage.setItem(LAST_TOKEN_KEY, token);
    else await AsyncStorage.removeItem(LAST_TOKEN_KEY);
  } catch {
    /* best-effort */
  }
}

export async function recallToken(): Promise<string | null> {
  if (lastToken) return lastToken;
  try {
    lastToken = await AsyncStorage.getItem(LAST_TOKEN_KEY);
  } catch {
    lastToken = null;
  }
  return lastToken;
}
