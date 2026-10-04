/**
 * Device location → server (`PUT /v1/me/location`).
 *
 * The radius filter on a paper plane only works if the server knows
 * roughly where the sender is, so we upload a coarse fix:
 *   - when the app becomes active (silent — never shows a permission
 *     prompt before the first-run permission flow has run), and
 *   - right before sending a plane that has a radius filter (best-effort,
 *     short timeout — the send never waits long on this).
 *
 * Throttle: skip the upload if the last one was < 10 min ago AND the
 * device moved < 1 km since. The last upload is kept in memory and in
 * AsyncStorage so cold starts don't re-upload needlessly.
 *
 * Everything here is best-effort: functions never throw.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import { Platform } from 'react-native';

import { updateMyLocation } from '@/lib/api/planes-api';
import { Location } from '@/lib/native/permissions';
import { requestLocationPermission } from '@/lib/permissions';

const LAST_UPLOAD_KEY = 'swing/v1/location/last-upload';
/** Written by `lib/permissions.ts` once the first-run flow has asked. Read-only here. */
const PERMISSIONS_ASKED_KEY = 'swing/v1/permissions/asked';

const THROTTLE_MS = 10 * 60 * 1000;
const MIN_MOVE_KM = 1;
const DEFAULT_TIMEOUT_MS = 4000;

type Fix = { lat: number; lng: number };
type LastUpload = Fix & { at: number };

let lastUpload: LastUpload | null = null;
let lastUploadLoaded = false;
let inflight: Promise<boolean> | null = null;

async function loadLastUpload(): Promise<LastUpload | null> {
  if (lastUploadLoaded) return lastUpload;
  lastUploadLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(LAST_UPLOAD_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<LastUpload>;
      if (
        typeof v.lat === 'number' &&
        typeof v.lng === 'number' &&
        typeof v.at === 'number'
      ) {
        // Keep whichever is newer (memory may have been set meanwhile).
        if (!lastUpload || lastUpload.at < v.at) {
          lastUpload = { lat: v.lat, lng: v.lng, at: v.at };
        }
      }
    }
  } catch {
    /* best-effort */
  }
  return lastUpload;
}

async function saveLastUpload(v: LastUpload) {
  lastUpload = v;
  try {
    await AsyncStorage.setItem(LAST_UPLOAD_KEY, JSON.stringify(v));
  } catch {
    /* best-effort */
  }
}

/** Forget the last upload (e.g. on sign-out). */
export async function resetLocationSync(): Promise<void> {
  lastUpload = null;
  lastUploadLoaded = true;
  try {
    await AsyncStorage.removeItem(LAST_UPLOAD_KEY);
  } catch {
    /* best-effort */
  }
}

export function distanceKm(a: Fix, b: Fix): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function firstRunPermissionFlowDone(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PERMISSIONS_ASKED_KEY);
    if (!raw) return false;
    return !!(JSON.parse(raw) as { location?: boolean }).location;
  } catch {
    return false;
  }
}

/**
 * Whether we may read the location right now.
 *   prompt=false → never trigger an OS dialog.
 *   prompt=true  → may ask (user explicitly chose a radius filter).
 */
async function canReadLocation(prompt: boolean): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      const existing = await Location.getForegroundPermissionsAsync();
      if (existing.granted) return true;
      if (!prompt) return false;
      const res = await requestLocationPermission();
      return res.granted;
    }
    // iOS: the OS prompts on the first position request. Only allow that
    // when explicitly prompting, or once the first-run flow has run.
    if (prompt) return true;
    return await firstRunPermissionFlowDone();
  } catch {
    return false;
  }
}

/** Coarse current position with a hard timeout. Resolves null on any failure. */
export function getCurrentFix(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Fix | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: Fix | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      Geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            finish({ lat: latitude, lng: longitude });
          } else {
            finish(null);
          }
        },
        () => finish(null),
        {
          enableHighAccuracy: false,
          timeout: timeoutMs,
          maximumAge: 5 * 60 * 1000,
        },
      );
    } catch {
      finish(null);
    }
  });
}

export type SyncLocationOptions = {
  /** Upload even if the throttle says it's not needed. */
  force?: boolean;
  /** Allow an OS permission prompt. Default false. */
  prompt?: boolean;
  /** Max time to wait for a fix. Default 4s. */
  timeoutMs?: number;
};

/**
 * Upload the device location if needed. Resolves `true` when the server
 * has a fresh-enough location (uploaded now or recently), `false`
 * otherwise. Never throws. Concurrent calls share one in-flight run.
 */
export function syncLocationIfNeeded(
  opts: SyncLocationOptions = {},
): Promise<boolean> {
  if (inflight) return inflight;
  inflight = runSync(opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSync({
  force = false,
  prompt = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SyncLocationOptions): Promise<boolean> {
  try {
    const started = Date.now();
    if (!(await canReadLocation(prompt))) return false;
    const remaining = Math.max(500, timeoutMs - (Date.now() - started));
    const fix = await getCurrentFix(remaining);
    if (!fix) return false;

    const last = await loadLastUpload();
    if (
      !force &&
      last &&
      Date.now() - last.at < THROTTLE_MS &&
      distanceKm(last, fix) < MIN_MOVE_KM
    ) {
      return true;
    }

    await updateMyLocation(fix.lat, fix.lng);
    await saveLastUpload({ ...fix, at: Date.now() });
    return true;
  } catch {
    return false;
  }
}
