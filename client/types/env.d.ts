declare module '@env' {
  export const SWING_API_URL: string;
  export const SWING_GOOGLE_WEB_CLIENT_ID: string;
  export const SWING_GOOGLE_IOS_CLIENT_ID: string;
  export const SWING_GOOGLE_ANDROID_CLIENT_ID: string;
  /** Legacy names — still read from .env if present */
  export const EXPO_PUBLIC_API_URL: string;
  export const EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: string;
  export const EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: string;
  export const EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: string;
}
