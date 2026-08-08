/**
 * Press target that ignores taps when the finger moved (swipes won't fire onPress).
 * Uses React Native Pressable — no react-native-gesture-handler Gesture API.
 */

import { type ReactNode, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const MAX_TAP_DISTANCE = 12;

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  delayLongPress?: number;
};

export function SwipeSafePressable({
  onPress,
  onLongPress,
  children,
  style,
  disabled,
  delayLongPress = 320,
}: Props) {
  const [pressed, setPressed] = useState(false);
  const start = useRef({ x: 0, y: 0 });
  const moved = useRef(false);

  const flatStyle = StyleSheet.flatten([
    style,
    pressed && !disabled ? { opacity: 0.75 } : null,
  ]);

  return (
    <Pressable
      disabled={disabled}
      delayLongPress={delayLongPress}
      onLongPress={onLongPress}
      onPressIn={(e) => {
        moved.current = false;
        start.current = {
          x: e.nativeEvent.pageX,
          y: e.nativeEvent.pageY,
        };
        setPressed(true);
      }}
      onPressOut={() => setPressed(false)}
      onTouchMove={(e) => {
        const dx = Math.abs(e.nativeEvent.pageX - start.current.x);
        const dy = Math.abs(e.nativeEvent.pageY - start.current.y);
        if (dx > MAX_TAP_DISTANCE || dy > MAX_TAP_DISTANCE) {
          moved.current = true;
        }
      }}
      onPress={() => {
        if (!moved.current && onPress) onPress();
      }}
      style={flatStyle}
    >
      {children}
    </Pressable>
  );
}
