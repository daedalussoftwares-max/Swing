/**
 * Splash screen — first thing the user sees on cold start when they
 * are not signed in. Shows the cursive Swing wordmark in the centre
 * with a tagline beneath, then auto-advances to /signup after 3s.
 *
 * Design: the screen *also* gets a soft fade-in on the logo so the
 * transition from the native launch screen feels intentional. We use
 * Reanimated rather than the Animated API for consistency with the
 * rest of the app.
 */

import { Image } from '@/lib/native/image';
import { useRouter } from '@/lib/router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const SPLASH_MS = 3000;

export default function SplashScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  const opacity = useSharedValue(0);
  const lift = useSharedValue(8); // tiny vertical rise

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
    lift.value = withTiming(0, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });

    const t = setTimeout(() => {
      // Replace so the user can't swipe back to splash.
      router.replace('/(auth)/signup');
    }, SPLASH_MS);
    return () => clearTimeout(t);
  }, [opacity, lift, router]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: lift.value }],
  }));

  const taglineStyle = useAnimatedStyle(() => ({
    opacity: withDelay(120, withTiming(opacity.value)),
  }));

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <View style={styles.content}>
        <Animated.View style={logoStyle}>
          <Image
            source={require('@/assets/images/swing-logo.png')}
            style={styles.logo}
            contentFit="contain"
          />
        </Animated.View>
      </View>

      <Animated.View style={[styles.taglineWrap, taglineStyle]}>
        <ThemedText style={[styles.tagline, { color: c.textMuted }]}>
          Send a paper plane to someone new.
        </ThemedText>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 288,
    height: 96,
  },
  taglineWrap: {
    alignItems: 'center',
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  tagline: {
    fontSize: 14,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
});
