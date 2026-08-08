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
import { uploadAndSaveAvatar } from '@/lib/upload-media';

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
};

// ── Validation ────────────────────────────────────────────────────────────

export const emailSchema = z.email('Please enter a valid email');
export const passwordSchema = z
  .string()
  .min(6, 'Password must be at least 6 characters');

function validateEmail(email: string): void {
  const result = emailSchema.safeParse(email.trim());
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'Invalid email';
    throw new AuthError('INVALID_EMAIL', msg);
  }
}

function validatePassword(password: string): void {
  const result = passwordSchema.safeParse(password);
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'Invalid password';
    throw new AuthError('INVALID_PASSWORD', msg);
  }
}

const API_TO_AUTH: Record<string, AuthErrorCode> = {
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    user: null,
  });

  useEffect(() => {
    (async () => {
      try {
        const { accessToken, refreshToken } = await readTokens();

        if (refreshToken) {
          try {
            const session = await authApi.refresh(refreshToken);
            await writeTokens(session.accessToken, session.refreshToken);
            setState({ status: 'signed-in', user: session.user });
            return;
          } catch (e) {
            if (e instanceof ApiError && e.code === 'INVALID_TOKEN') {
              await clearTokens();
            } else if (!(e instanceof ApiError)) {
              // offline — keep loading until user retries? treat as signed-out
            }
          }
        }

        if (accessToken) {
          try {
            const user = await authApi.getMe(accessToken);
            setState({ status: 'signed-in', user });
            return;
          } catch {
            await clearTokens();
          }
        }

        setState({ status: 'signed-out', user: null });
      } catch {
        setState({ status: 'signed-out', user: null });
      }
    })();
  }, []);

  const signUpWithEmail = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      validateEmail(email);
      validatePassword(password);
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
    const { accessToken } = await readTokens();
    if (!accessToken) {
      throw new AuthError('INVALID_TOKEN', 'Session expired. Please sign in again.');
    }
    try {
      const user = await authApi.updateProfile(accessToken, patch);
      setState({ status: 'signed-in', user });
      return user;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof ApiError) throw mapApiError(e);
      throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
    }
  }, []);

  const uploadAvatar = useCallback(async (localUri: string, mimeType?: string) => {
    const { accessToken } = await readTokens();
    if (!accessToken) {
      throw new AuthError('INVALID_TOKEN', 'Session expired. Please sign in again.');
    }
    try {
      const user = await uploadAndSaveAvatar(accessToken, localUri, mimeType);
      setState({ status: 'signed-in', user });
      return user;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof ApiError) throw mapApiError(e);
      throw new AuthError('UNKNOWN', 'Something went wrong. Please try again.');
    }
  }, []);

  const deleteAccountRemote = useCallback(async () => {
    const { accessToken, refreshToken } = await readTokens();
    if (!accessToken) {
      throw new AuthError('INVALID_TOKEN', 'Session expired. Please sign in again.');
    }
    try {
      await authApi.deleteAccount(accessToken);
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
