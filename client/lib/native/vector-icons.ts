/**
 * Icon fonts for bare React Native (replaces @expo/vector-icons + expo-font).
 */
import RNIonicons from 'react-native-vector-icons/Ionicons';
import glyphMap from 'react-native-vector-icons/glyphmaps/Ionicons.json';

type IoniconsComponent = typeof RNIonicons & {
  glyphMap: typeof glyphMap;
};

const Ionicons = RNIonicons as IoniconsComponent;
Ionicons.glyphMap = glyphMap;

export { Ionicons };
