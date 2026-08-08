/**
 * App-wide permission orchestration.
 *
 * We only need two OS-level permissions for the MVP:
 *   1. Notifications  — so plane arrivals / chat pings can wake the user
 *   2. Location       — radius filter + nearby matching
 *
 * iOS in particular dislikes back-to-back permission dialogs (the
 * second one frequently appears to be "swallowed" if it's queued while
 * the first sheet is still animating out). So we *sequence* the two
 * asks with a small inter-prompt gap and never block the UI.
 *
 * We also persist a "have we ever asked this user before?" flag in
 * AsyncStorage so we don't re-prompt every cold start — once the user
 * has chosen (Allow / Deny / Don't Ask Again), the OS owns the state
 * and we should not pester them again. Re-asking only makes sense
 * from explicit affordances (e.g. a settings toggle).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Location, Notifications } from '@/lib/native/permissions';

const KEY = 'swing/v1/permissions/asked';

type AskedFlag = {
  notifications?: boolean;
  location?: boolean;
};

async function readAsked(): Promise<AskedFlag> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AskedFlag) : {};
  } catch {
    return {};
  }
}

async function writeAsked(next: AskedFlag) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

export type PermissionResult = {
  granted: boolean;
  /** Whether we showed a native prompt this time (vs. returning a
   *  cached "already chosen" decision). Useful so callers know
   *  whether the gap timer is even needed. */
  prompted: boolean;
  /** OS-level status string for debugging only. */
  status: string;
};

/**
 * Ask for push-notification permission. iOS auto-prompts; Android 13+
 * also requires runtime permission. Older Android grants implicitly.
 */
export async function requestNotificationsPermission(): Promise<PermissionResult> {
  const existing = await Notifications.getPermissionsAsync();
  // `granted` is true even when status is "provisional" on iOS.
  if (existing.granted || existing.status === 'denied') {
    return {
      granted: existing.granted,
      prompted: false,
      status: existing.status,
    };
  }
  const result = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  return {
    granted: result.granted,
    prompted: true,
    status: result.status,
  };
}

/**
 * Ask for foreground location permission. We deliberately ask for
 * *when-in-use* only — background location is overkill for MVP and
 * triggers extra App Store review scrutiny.
 */
export async function requestLocationPermission(): Promise<PermissionResult> {
  const existing = await Location.getForegroundPermissionsAsync();
  if (existing.granted || existing.status === 'denied') {
    return {
      granted: existing.granted,
      prompted: false,
      status: existing.status,
    };
  }
  const result = await Location.requestForegroundPermissionsAsync();
  return {
    granted: result.granted,
    prompted: true,
    status: result.status,
  };
}

/**
 * Sequenced "first-run" prompt: notifications first, then location.
 *
 * Why this order:
 *   - Notifications has the higher product impact (a chat app without
 *     pings feels broken), so we ask it first while user engagement
 *     is highest.
 *   - Location is useful but the app degrades gracefully without it.
 *
 * Subsequent calls are no-ops for any permission we've already asked
 * about — the persisted flag prevents pestering even across app
 * relaunches.
 */
export async function runFirstTimePermissionFlow(): Promise<{
  notifications: PermissionResult;
  location: PermissionResult;
}> {
  const asked = await readAsked();

  // ── Notifications ───────────────────────────────────────────────
  let notifications: PermissionResult;
  if (asked.notifications) {
    const existing = await Notifications.getPermissionsAsync();
    notifications = {
      granted: existing.granted,
      prompted: false,
      status: existing.status,
    };
  } else {
    notifications = await requestNotificationsPermission().catch((e) => ({
      granted: false,
      prompted: false,
      status: `error:${(e as Error)?.message ?? 'unknown'}`,
    }));
  }

  // Small inter-prompt gap so the second native sheet doesn't queue
  // up while the first is still animating away.
  if (notifications.prompted) {
    await new Promise<void>((r) => setTimeout(r, 600));
  }

  // ── Location ────────────────────────────────────────────────────
  let location: PermissionResult;
  if (asked.location) {
    const existing = await Location.getForegroundPermissionsAsync();
    location = {
      granted: existing.granted,
      prompted: false,
      status: existing.status,
    };
  } else {
    location = await requestLocationPermission().catch((e) => ({
      granted: false,
      prompted: false,
      status: `error:${(e as Error)?.message ?? 'unknown'}`,
    }));
  }

  // Persist "we asked" markers so we don't keep nagging on every
  // cold start. Only flip the flag if we actually *did* prompt — if
  // the call errored out (e.g. native module not linked yet in Expo
  // Go) we want to retry next launch rather than silently give up.
  await writeAsked({
    notifications: asked.notifications || notifications.prompted,
    location: asked.location || location.prompted,
  });

  return { notifications, location };
}
