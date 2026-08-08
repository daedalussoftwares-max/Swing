# Swing client (bare React Native)

Bare React Native 0.81 app — **not** Expo Go.

## Layout

```
client/
├── App.tsx              # Root: providers + NavigationContainer
├── index.js             # AppRegistry entry
├── navigation/          # React Navigation (stack + tabs)
├── screens/             # Screen components
├── components/          # Shared UI
├── lib/                 # API, contexts, native shims
├── hooks/
├── constants/
└── types/
```

## Run

```bash
pnpm install
cp .env.example .env   # SWING_API_URL, Google client IDs
pnpm start
pnpm ios:sim           # or pnpm android
```

## Env vars (`client/.env`)

| Variable | Purpose |
|----------|---------|
| `SWING_API_URL` | Go backend (e.g. `http://localhost:8080`) |
| `SWING_GOOGLE_*_CLIENT_ID` | Google Sign-In |

Legacy `EXPO_PUBLIC_*` names still work.

## Navigation

- `navigation/RootNavigator.tsx` — auth stack + modal screens
- `navigation/MainTabNavigator.tsx` — bottom tabs
- `lib/router.tsx` — `useRouter`, `Link` shim (expo-router-style paths)

## Native shims

`lib/native/` wraps third-party modules (icons, Keychain, image picker, etc.).

## Mock data (until API wired)

`lib/mock-planes.ts`, `lib/mock-notifications.ts`, `lib/mock-sent-planes.ts` — planes/chats/notifications UI.
