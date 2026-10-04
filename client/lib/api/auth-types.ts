export type AuthUser = {
  id: string;
  email: string;
  provider: 'password' | 'google';
  username?: string;
  name?: string;
  dob?: string;
  gender?: 'M' | 'F' | 'NB';
  bio?: string;
  /** Comma-separated hashtags, e.g. "music,travel". */
  interests?: string;
  city?: string;
  country?: string;
  avatarUrl?: string;
  profileComplete: boolean;
  planesRemaining?: number;
  createdAt: string;
};

export type AuthSessionResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

export type MeResponse = {
  user: AuthUser;
};

export type ProfilePatchBody = {
  username?: string;
  name?: string;
  dob?: string;
  gender?: 'M' | 'F' | 'NB';
  bio?: string;
  interests?: string;
  city?: string;
  country?: string;
  avatarUrl?: string;
  profileComplete?: boolean;
};

export type UsernameAvailableResponse = {
  available: boolean;
};
