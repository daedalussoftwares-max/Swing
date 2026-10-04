import * as SecureStore from '@/lib/native/secure-store';

const ACCESS_KEY = 'access_token';
const REFRESH_KEY = 'refresh_token';

type Tokens = {
  accessToken: string | null;
  refreshToken: string | null;
};

// Keychain/Keystore reads are slow (they cross the native bridge and hit
// the secure enclave), and every API call needs the token — keep an
// in-memory copy and only touch secure storage on cold start and writes.
let cache: Tokens | null = null;
let loading: Promise<Tokens> | null = null;

export async function readTokens(): Promise<Tokens> {
  if (cache) return cache;
  if (!loading) {
    loading = (async () => {
      const accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      cache = { accessToken, refreshToken };
      loading = null;
      return cache;
    })();
  }
  return loading;
}

export async function writeTokens(accessToken: string, refreshToken: string) {
  cache = { accessToken, refreshToken };
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
}

export async function clearTokens() {
  cache = { accessToken: null, refreshToken: null };
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
