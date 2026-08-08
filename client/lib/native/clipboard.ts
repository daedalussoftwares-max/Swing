/**
 * Clipboard shim (replaces expo-clipboard).
 */
import Clipboard from '@react-native-clipboard/clipboard';

export async function setStringAsync(text: string): Promise<void> {
  Clipboard.setString(text);
}

export async function getStringAsync(): Promise<string> {
  return Clipboard.getString();
}
