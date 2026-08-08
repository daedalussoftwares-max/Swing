/**
 * Signup screen.
 *
 * Layout (top → bottom):
 *   1. Swipeable hero carousel (3 slides, paged dots)
 *   2. Bordered form card containing:
 *        • "Signup" title
 *        • email + password fields
 *        • "Create account" button
 *        • "or" divider
 *        • "Continue with Google" button (multicolor G logo)
 *        • "Already have an account? Log in" footer link
 *   3. Small Swing wordmark at the very bottom (brand reassurance)
 *
 * Validation lives inside `AuthContext.signUpWithEmail` (zod). Any
 * thrown error is funnelled through `humanizeAuthError` so the inline
 * error banner never shows a raw JSON/zod dump.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import * as Haptics from '@/lib/native/haptics';
import { Image } from '@/lib/native/image';
import { Link, useRouter } from '@/lib/router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthField } from '@/components/auth-field';
import { AuthHeroCarousel } from '@/components/auth-hero-carousel';
import { BlockingLoader } from '@/components/blocking-loader';
import { GoogleLogo } from '@/components/google-logo';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { humanizeAuthError, useAuth } from '@/lib/auth-context';
import { useGoogleSignIn } from '@/lib/google-auth';
import {
  humanizeGoogleError,
  isGoogleSignInCancelled,
} from '@/lib/google-user-messages';

export default function SignupScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { signUpWithEmail, signInWithGoogle } = useAuth();
  const google = useGoogleSignIn();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signUpWithEmail(email, password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(auth)/profile-setup');
    } catch (e) {
      setError(humanizeAuthError(e, 'Something went wrong. Try again.'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    if (google.setupError) {
      setError(google.setupError);
      return;
    }
    setSubmitting(true);
    try {
      const idToken = await google.signIn();
      const user = await signInWithGoogle(idToken);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(
        user.profileComplete ? '/(tabs)' : '/(auth)/profile-setup',
      );
    } catch (e) {
      if (isGoogleSignInCancelled(e)) return;
      setError(
        humanizeGoogleError(e, humanizeAuthError(e, 'Could not sign in with Google.')),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    email.trim().length > 3 && password.length >= 6 && !submitting;

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={!submitting}
        >
          {/* ── Hero carousel ─────────────────────────────────────── */}
          <View style={styles.heroWrap}>
            <AuthHeroCarousel animationHeight={180} />
          </View>

          {/* ── Boxed form ────────────────────────────────────────── */}
          <View
            style={[
              styles.formCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <ThemedText style={styles.title}>Signup</ThemedText>

            <AuthField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@swing.app"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            <AuthField
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="password-new"
              rightAdornment={
                <Pressable
                  onPress={() => setShowPassword((s) => !s)}
                  hitSlop={8}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={c.textMuted}
                  />
                </Pressable>
              }
            />

            {error ? (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: c.tintMuted, borderColor: c.danger + '33' },
                ]}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={c.danger}
                />
                <ThemedText style={[styles.errorText, { color: c.danger }]}>
                  {error}
                </ThemedText>
              </View>
            ) : null}

            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: canSubmit ? c.tint : c.borderStrong,
                  opacity: pressed && canSubmit ? 0.85 : 1,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <ThemedText style={styles.primaryBtnText}>
                  Create account
                </ThemedText>
              )}
            </Pressable>

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View
                style={[styles.dividerLine, { backgroundColor: c.border }]}
              />
              <ThemedText style={[styles.dividerText, { color: c.textSubtle }]}>
                or
              </ThemedText>
              <View
                style={[styles.dividerLine, { backgroundColor: c.border }]}
              />
            </View>

            {/* Google */}
            <Pressable
              onPress={handleGoogle}
              disabled={submitting}
              style={({ pressed }) => [
                styles.googleBtn,
                {
                  backgroundColor: c.surfaceAlt,
                  borderColor: c.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <GoogleLogo size={18} />
              <ThemedText style={[styles.googleBtnText, { color: c.text }]}>
                Continue with Google
              </ThemedText>
            </Pressable>

            {/* Footer link */}
            <View style={styles.footer}>
              <ThemedText style={[styles.footerText, { color: c.textMuted }]}>
                Already have an account?{' '}
              </ThemedText>
              <Link href="/(auth)/signin" replace asChild>
                <Pressable hitSlop={6}>
                  <ThemedText style={[styles.footerLink, { color: c.tint }]}>
                    Log in
                  </ThemedText>
                </Pressable>
              </Link>
            </View>
          </View>

          {/* Brand wordmark — small, decorative, anchors the screen */}
          <View style={styles.brandWrap}>
            <Image
              source={require('@/assets/images/swing-logo.png')}
              style={styles.brand}
              contentFit="contain"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BlockingLoader visible={submitting} message="Please wait…" />
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
// Note on button radius: switched from `Radii.pill` (oval) to `Radii.lg`
// to match the soft-curved card style used on the home screen.

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  heroWrap: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },

  // The whole signup section sits inside a single bordered card so the
  // form reads as one unit, separated visually from the carousel above
  // and the wordmark below.
  formCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },

  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: Spacing.md,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  errorText: { fontSize: 12, flex: 1 },

  primaryBtn: {
    height: 50,
    borderRadius: Radii.lg, // soft curve (was Radii.pill)
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginVertical: Spacing.md,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 12 },

  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 50,
    borderRadius: Radii.lg, // same soft curve as primary
    borderWidth: StyleSheet.hairlineWidth,
  },
  googleBtnText: { fontSize: 14, fontWeight: '600' },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  footerText: { fontSize: 13 },
  footerLink: { fontSize: 13, fontWeight: '700' },

  brandWrap: {
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  // Logo at the foot of the form — bumped from 28×84 so it reads
  // properly as a brand anchor rather than a decorative speck.
  brand: {
    height: 44,
    width: 132,
    opacity: 0.9,
  },
});
