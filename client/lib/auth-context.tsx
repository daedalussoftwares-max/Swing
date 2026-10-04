/**
 * Authentication context — email/password against the Swing Go API.
 * Tokens live in expo-secure-store; user state is refreshed via /v1/me.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { z } from 'zod';

import { ApiError } from '@/lib/api/client';
import * as authApi from '@/lib/api/auth-api';
import type { AuthUser, ProfilePatchBody } from '@/lib/api/auth-types';
import { messageForApiCode } from '@/lib/api/user-messages';
import {
  clearTokens,
  readTokens,
  writeTokens,
} from '@/lib/api/token-storage';
import {
  getFreshAccessToken,
  onSessionExpired,
  refreshSession,
} from '@/lib/api/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadAndSaveAvatar } from '@/lib/upload-media';
import { unregisterPushToken } from '@/lib/push/unregister';

// ── Public types ──────────────────────────────────────────────────────────

export type { AuthUser };

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signed-out'; user: null }
  | { status: 'signed-in'; user: AuthUser };

type AuthContextValue = AuthState & {
  signUpWithEmail: (email: string, password: string) => Promise<AuthUser>;
  signInWithEmail: (email: string, password: string) => Promise<AuthUser>;
  signInWithGoogle: (idToken: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  saveProfile: (patch: ProfilePatchBody) => Promise<AuthUser>;
  uploadAvatar: (localUri: string, mimeType?: string) => Promise<AuthUser>;
  deleteAccountRemote: () => Promise<void>;
  /** Reload /v1/me (e.g. after spending a plane). */
  refreshUser: () => Promise<AuthUser | null>;
};

// ── Validation ────────────────────────────────────────────────────────────

export const emailSchema = z.email('Please enter a valid email');
export const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters');
/** New accounts need a longer password (server enforces 8–72 bytes). */
export const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

function validateEmail(email: string): void {
  const result = emailSchema.safeParse(email.trim());
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'Invalid email';
    throw new AuthError('INVALID_EMAIL', msg);
  }
}

function validatePassword(password: string, isNew = false): void {
  const result = (isNew ? newPasswordSchema : passwordSchema).safeParse(
    password,
  );
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'Invalid password';
    throw new AuthError('INVALID_PASSWORD', msg);
  }
}

const API_TO_AUTH: Record<string, AuthErrorCode> = {
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_INPUT: 'INVALID_INPUT',
  USERNAME_TAKEN: 'INVALID_INPUT',
  USERNAME_INVALID: 'INVALID_INPUT',
  USERNAME_RESERVED: 'INVALID_INPUT',
  GOOGLE_AUTH_FAILED: 'UNKNOWN',
  GOOGLE_NOT_CONFIGURED: 'UNKNOWN',
  NETWORK: 'NETWORK',
};

function mapApiError(err: ApiError): AuthError {
  const code = API_TO_AUTH[err.code] ?? 'UNKNOWN';
  return new AuthError(code, messageForApiCode(err.code, err.message));
}

async function persistSession(
  accessToken: string,
  refreshToken: string,
  user: AuthUser,
): Promise<AuthUser> {
  try {
    await writeTokens(accessToken, refreshToken);
  } catch {
    throw new AuthError(
      'UNKNOWN',
      'Could not save your session. Please try again.',
    );
  }
  return user;
}

// ── Context plumbing ──────────────────────────────────────────────────────

const USER_CACHE_KEY = 'swing.me.v1';

async function readCachedUser(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

async function writeCachedUser(user: AuthUser): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    /* best effort */
  }
}

async function clearCachedUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_CACHE_KEY);
  } catch {
    /* best effort */
  }
}

/**
 * GET /v1/me with one refresh-and-retry on 401. Resolves null only when the
 * session is really over; throws on network/server errors.
 */
async function fetchMe(): Promise<AuthUser | null> {
  if (!(await getFreshAccessToken())) return null;
  try {
    // authedFetch already refreshes + retries once on 401.
    return await authApi.getMe();
  } catch (e) {
    if (e instanceof ApiError && e.httpStatus === 401) return null;
    throw e;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
  });

  // Refresh token rejected mid-session (revoked / expired) → back to login.
  useEffect(
    () =>
      onSessionExpired(() => {
        void clearCachedUser();
        setState({ status: 'signed-out', user: null });
      }),
    [],
  );

  // Bootstrap. The session only ends when the server rejects the refresh
  // token; offline / server hiccups keep the user signed in (with their
  // last known profile) and keep retrying in the background.
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const run = async () => {
      const { accessToken, refreshToken } = await readTokens();
      if (!accessToken && !refreshToken) {
        if (!cancelled) setState({ status: 'signed-out', user: null });
        return;
      }
      try {
        const session = await refreshSession();
        if (cancelled) return;
        if (session) {
          setState({ status: 'signed-in', user: session.user });
        } else {
          await clearCachedUser();
          setState({ status: 'signed-out', user: null });
        }
      } catch {
        if (cancelled) return;
        const cached = await readCachedUser();
        if (cancelled) return;
        if (cached) {
          setState((cur) => (cur.status === 'signed-in' ? cur : { status: 'signed-in', user: cached }));
        }
        attempt += 1;
        retryTimer = setTimeout(() => void run(), Math.min(30_000, 2_000 * 2 ** (attempt - 1)));
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  // Remember the last signed-in profile so a cold start without network
  // can still open the app.
  useEffect(() => {
    if (state.status === 'signed-in' && state.user) void writeCachedUser(state.user);
  }, [state]);

  const signUpWithEmail = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      validateEmail(email);
      validatePassword(password, true);
      try {
        const session = await authApi.register(
          email.trim().toLowerCase(),
          password,
        );
        const user = await persistSession(
          session.accessToken,
          session.refreshToken,
          session.user,
        );
        setState({ status: 'signed-in', user });
        return user;
      } catch (e) {
        if (e instanceof AuthError) throw e;
        if (e instanceof ApiError) throw mapApiError(e);
        throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
      }
    },
    [],
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      validateEmail(email);
      validatePassword(password);
      try {
        const session = await authApi.login(
          email.trim().toLowerCase(),
          password,
        );
        const user = await persistSession(
          session.accessToken,
          session.refreshToken,
          session.user,
        );
        setState({ status: 'signed-in', user });
        return user;
      } catch (e) {
        if (e instanceof AuthError) throw e;
        if (e instanceof ApiError) throw mapApiError(e);
        throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
      }
    },
    [],
  );

  const signInWithGoogle = useCallback(
    async (idToken: string): Promise<AuthUser> => {
      try {
        const session = await authApi.loginWithGoogle(idToken);
        const user = await persistSession(
          session.accessToken,
          session.refreshToken,
          session.user,
        );
        setState({ status: 'signed-in', user });
        return user;
      } catch (e) {
        if (e instanceof AuthError) throw e;
        if (e instanceof ApiError) throw mapApiError(e);
        throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    await clearCachedUser();
    await unregisterPushToken(); // before tokens are cleared
    const { refreshToken } = await readTokens();
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // still clear local session
      }
    }
    await clearTokens();
    setState({ status: 'signed-out', user: null });
  }, []);

  const saveProfile = useCallback(async (patch: ProfilePatchBody) => {
    try {
      const user = await authApi.updateProfile(patch);
      setState({ status: 'signed-in', user });
      return user;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof ApiError) throw mapApiError(e);
      throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
    }
  }, []);

  const uploadAvatar = useCallback(async (localUri: string, mimeType?: string) => {
    try {
      const user = await uploadAndSaveAvatar(localUri, mimeType);
      setState({ status: 'signed-in', user });
      return user;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof ApiError) throw mapApiError(e);
      throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
    }
  }, []);

  const refreshUser = useCallback(async (): Promise<AuthUser | null> => {
    try {
      const user = await fetchMe();
      if (!user) {
        setState({ status: 'signed-out', user: null });
        return null;
      }
      setState({ status: 'signed-in', user });
      return user;
    } catch {
      // Transient failure: keep the current session and profile.
      return null;
    }
  }, []);

  const deleteAccountRemote = useCallback(async () => {
    const { refreshToken } = await readTokens();
    try {
      await authApi.deleteAccount();
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof ApiError) throw mapApiError(e);
      throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
    }
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        /* account already gone */
      }
    }
    await clearTokens();
    setState({ status: 'signed-out', user: null });
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    if (state.status === 'loading') {
      return {
        status: 'loading',
        user: null,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        signOut,
        saveProfile,
        uploadAvatar,
        deleteAccountRemote,
        refreshUser,
      };
    }
    if (state.status === 'signed-out') {
      return {
        status: 'signed-out',
        user: null,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        signOut,
        saveProfile,
        uploadAvatar,
        deleteAccountRemote,
        refreshUser,
      };
    }
    return {
      status: 'signed-in',
      user: state.user,
      signUpWithEmail,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      saveProfile,
      uploadAvatar,
      deleteAccountRemote,
      refreshUser,
    };
  }, [
    state,
    signUpWithEmail,
    signInWithEmail,
    signInWithGoogle,
    signOut,
    saveProfile,
    uploadAvatar,
    deleteAccountRemote,
    refreshUser,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

// ── Error type ────────────────────────────────────────────────────────────

export type AuthErrorCode =
  | 'INVALID_EMAIL'
  | 'INVALID_PASSWORD'
  | 'EMAIL_IN_USE'
  | 'USER_NOT_FOUND'
  | 'WRONG_PASSWORD'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'INVALID_INPUT'
  | 'NETWORK'
  | 'UNKNOWN';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AuthError';
  }
}

export function humanizeAuthError(err: unknown, fallback: string): string {
  if (err instanceof AuthError) return err.message;
  if (err instanceof ApiError) {
    return messageForApiCode(err.code, err.message);
  }
  if (err instanceof z.ZodError) {
    return err.issues[0]?.message ?? fallback;
  }
  return fallback;
}
