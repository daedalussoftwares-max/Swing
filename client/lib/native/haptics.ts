/**
 * Haptics shim (replaces expo-haptics).
 */
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

const options = { enableVibrateFallback: true, ignoreAndroidSystemSettings: false };

export const NotificationFeedbackType = {
  Success: 'notificationSuccess' as const,
  Error: 'notificationError' as const,
  Warning: 'notificationWarning' as const,
};

export const ImpactFeedbackStyle = {
  Light: 'impactLight' as const,
  Medium: 'impactMedium' as const,
  Heavy: 'impactHeavy' as const,
};

type NotificationType =
  | typeof NotificationFeedbackType.Success
  | typeof NotificationFeedbackType.Error
  | typeof NotificationFeedbackType.Warning;

type ImpactType =
  | typeof ImpactFeedbackStyle.Light
  | typeof ImpactFeedbackStyle.Medium
  | typeof ImpactFeedbackStyle.Heavy
  | 'light'
  | 'medium'
  | 'heavy';

const IMPACT_MAP: Record<string, string> = {
  light: 'impactLight',
  medium: 'impactMedium',
  heavy: 'impactHeavy',
  impactLight: 'impactLight',
  impactMedium: 'impactMedium',
  impactHeavy: 'impactHeavy',
};

export async function notificationAsync(type: NotificationType): Promise<void> {
  ReactNativeHapticFeedback.trigger(type, options);
}

export async function selectionAsync(): Promise<void> {
  ReactNativeHapticFeedback.trigger('selection', options);
}

export async function impactAsync(style: ImpactType = ImpactFeedbackStyle.Light): Promise<void> {
  const mapped = IMPACT_MAP[style] ?? 'impactLight';
  ReactNativeHapticFeedback.trigger(mapped as 'impactLight', options);
}
