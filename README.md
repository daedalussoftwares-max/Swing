# Swing

A social messaging app where users send "paper plane" messages to random people based on filters (radius, country, gender, age). If the recipient accepts, they become connected and can chat. If they reject, the plane flies on to the next person with the same filters until it expires after 24 hours.

> The product name is a working title and may change before launch.

## Repository structure

```
swing/
├── client/              # React Native (Expo) app — iOS & Android
└── backend/
    └── serving/         # Main Go REST API (Neon Postgres) — may rename to eros
```

Each folder is self-contained with its own `package.json` and dependencies. They are deployed independently.

## Prerequisites

- Node.js 22 LTS + pnpm 11+
- **Android:** Android Studio (SDK + emulator or USB device)
- **iPhone:** Xcode from the Mac App Store (Android Studio cannot build iOS)
- Neon Postgres for the Go API (see backend section)

Expo Go is **not** supported. Native projects in `client/android` and `client/ios` are built with **Android Studio** and **Xcode**.

The app still uses the **Expo SDK** (expo-router, expo-location, etc.) — that is not the same as the Expo Go app.

## Running the client (native dev build)

### First-time setup

```bash
cd client
pnpm install
cp .env.example .env
# Set EXPO_PUBLIC_API_URL to your Mac IP, e.g. http://172.20.10.7:8080

# Generate native projects (already done once; re-run after adding native modules)
pnpm prebuild
```

### Android (Android Studio)

1. Open **Android Studio** → **Open** → select `client/android`
2. Wait for Gradle sync
3. Start an emulator or connect a phone (USB debugging on)
4. In a terminal:

```bash
cd client
pnpm start          # Metro for dev client
pnpm android        # build + install on emulator/device
```

Or run from Android Studio: green **Run** button on the `app` configuration.

### iPhone (Xcode — Mac only)

1. Install **Xcode** from the App Store
2. `cd client && pnpm ios` (simulator) or `pnpm ios -- --device` (USB iPhone)
3. Or open `client/ios/swing.xcworkspace` in Xcode and press Run

Daily dev after the app is installed once:

```bash
cd client
pnpm start          # Metro — "Using development build"
```

Reload the installed Swing app on the device — it connects to Metro automatically on the same network.

### Env note

- Physical phone: `EXPO_PUBLIC_API_URL=http://YOUR_MAC_IP:8080` (not `localhost`)
- Android emulator: `http://10.0.2.2:8080`

## Running the backend (serving API)

```bash
cd backend/serving
cp config/setup/local/dev.local.yaml.example config/setup/local/dev.local.yaml
# Fill database.url (Neon) and auth.jwt_secret
go mod tidy
PROFILE=dev SETUP=local go run .
```

See `backend/serving/README.md` for layout and routes.

## Tech stack

**Client**

- Expo SDK 54 (React Native + TypeScript)
- `expo-router` for navigation

**Backend (`backend/serving`)**

- Go + chi router
- Neon Postgres
- JWT access + refresh tokens (email/password auth)
