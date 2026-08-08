/**
 * Secure storage shim (replaces expo-secure-store).
 */
import * as Keychain from 'react-native-keychain';

const SERVICE = 'com.rahulsaw.swing';

export async function getItemAsync(key: string): Promise<string | null> {
  const creds = await Keychain.getGenericPassword({ service: `${SERVICE}.${key}` });
  if (!creds) return null;
  return creds.password;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  await Keychain.setGenericPassword(key, value, {
    service: `${SERVICE}.${key}`,
  });
}

export async function deleteItemAsync(key: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: `${SERVICE}.${key}` });
}
