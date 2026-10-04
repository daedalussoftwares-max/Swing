/**
 * Push device registration (FCM tokens) — POST/DELETE /v1/devices.
 */
import { authedFetch } from '@/lib/api/authed-fetch';

export type PushPlatform = 'ios' | 'android';

export async function registerPushDevice(
  token: string,
  platform: PushPlatform,
): Promise<void> {
  await authedFetch('/v1/devices', {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });
}

/** Removes this device's token so the signed-out account stops getting pushes. */
export async function unregisterPushDevice(token: string): Promise<void> {
  await authedFetch('/v1/devices', {
    method: 'DELETE',
    body: JSON.stringify({ token }),
  });
}
