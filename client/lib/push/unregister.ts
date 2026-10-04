/**
 * Called at the very start of signOut (while the access token is still
 * valid) so the server stops pushing this account's notifications to the
 * device. Never throws and never blocks sign-out for long.
 */
import { unregisterPushDevice } from '@/lib/api/devices-api';
import { recallToken, rememberToken } from '@/lib/push/firebase';

const UNREGISTER_TIMEOUT_MS = 3000;

export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await recallToken();
    if (!token) return;
    await Promise.race([
      unregisterPushDevice(token),
      new Promise<void>((resolve) => setTimeout(resolve, UNREGISTER_TIMEOUT_MS)),
    ]);
  } catch {
    // Offline / expired session: the server prunes dead tokens anyway.
  } finally {
    await rememberToken(null);
  }
}
