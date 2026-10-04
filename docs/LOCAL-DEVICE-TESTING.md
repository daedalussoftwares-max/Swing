# Test Swing on one iPhone + one Android (local API on your Mac)

Your Mac runs **Postgres + Go API**. Both phones use the **same Wi‑Fi** (or connect both phones to your **Mac’s Personal Hotspot**). The app must call your Mac’s **LAN IP**, not `localhost`.

> **iPhone cannot install an APK.** Use a **debug build from Xcode** (USB) or share a debug build via TestFlight later. Android can use a **debug APK** file.

---

## 1. Network checklist

| Requirement | Why |
|-------------|-----|
| Mac + both phones on **same network** | Phones must reach `http://<mac-ip>:8080` |
| Mac firewall allows **incoming** on port **8080** | System Settings → Network → Firewall → allow `go` / Terminal or turn firewall off briefly for testing |
| `SWING_API_URL` uses **Mac IP** | `localhost` on the phone means the phone itself |

**Find your Mac IP** (Wi‑Fi):

```bash
ipconfig getifaddr en0
```

If empty (Ethernet/USB), try `en1`. With **Personal Hotspot**, the Mac is often `172.20.10.1` and phones are `172.20.10.x`.

**Smoke test from a phone browser** (same Wi‑Fi):

```text
http://YOUR_MAC_IP:8080/health
```

You should see a healthy JSON response. If not, fix network/firewall before building the app.

---

## 2. Start backend on the Mac

### Postgres (Docker)

```bash
cd backend
docker compose up -d
```

### API config

```bash
cd backend/serving
cp config/setup/local/dev.local.yaml.example config/setup/local/dev.local.yaml
```

Edit `dev.local.yaml` — minimal local example:

```yaml
database:
  url: "postgresql://postgres:swing@127.0.0.1:5432/swing?sslmode=disable"

auth:
  jwt_secret: "dev-only-change-me-use-openssl-rand-hex-32"
  google_client_id: "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
  google_client_ids:
    - "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com"
```

R2 is optional for planes/chat text; avatars may need R2 later.

### Run API (listen on all interfaces — `:8080`)

```bash
cd backend/serving
PROFILE=dev SETUP=local go run .
```

Leave this terminal open. API: `http://YOUR_MAC_IP:8080`.

**Helper** (prints IP + starts Docker + API):

```bash
./scripts/device-test.sh
```

---

## 3. Point the client at your Mac

```bash
cd client
cp .env.example .env
```

Set (use your real IP):

```env
SWING_API_URL=http://192.168.1.42:8080
```

`SWING_API_URL` is **inlined at bundle time** (Babel). After you change `.env`:

1. Stop Metro if running  
2. `cd client && pnpm start --reset-cache`  
3. **Rebuild/reinstall** the app on each device (see below)

WebSockets use the same host: `ws://YOUR_MAC_IP:8080/v1/ws`.

---

## 4. Android — physical device (recommended)

Use **two terminals on the Mac** plus USB debugging on the phone.

| Terminal | Command |
|----------|---------|
| **1 — API** | `cd backend/serving && PROFILE=dev SETUP=local go run .` |
| **2 — Metro** | `cd client && pnpm start` |
| **3 — App** | From repo root: `pnpm android:device` |

`android:device` syncs your Mac LAN IP into `client/.env`, runs `adb reverse` so the phone loads JS from Metro, checks `/health` and Metro, then `react-native run-android`.

Diagnostics only: `pnpm android:device:check`

### Option B — APK (second phone, or adb broken on OEM)

```bash
pnpm lan:sync
pnpm android:device:apk
```

APK path: `client/android/app/build/outputs/apk/debug/app-debug.apk` — copy to the phone and install. **Same Wi‑Fi as the Mac**, Metro running (`pnpm start`). After Wi‑Fi/hotspot change: `pnpm lan:sync` and **rebuild** the APK.

### Android checklist

| Step | Why |
|------|-----|
| Developer options → **USB debugging** | adb install / run |
| Phone browser → `http://<mac-ip>:8080/health` | API reachable before opening app |
| `pnpm lan:sync` when network changes | `SWING_API_URL` is baked into the JS bundle at build time |
| Metro on Mac (`pnpm start`) | Debug app loads JavaScript from `:8081` |

---

## 5. iPhone — install (no APK)

1. Connect iPhone with USB, trust the Mac, enable **Developer Mode** on the phone (Settings → Privacy & Security).  
2. Open `client/ios/swing.xcworkspace` in **Xcode**.  
3. Select your **physical device** as run destination.  
4. Signing: choose your **Team** (Apple ID).  
5. Product → **Run** (or `cd client && pnpm ios -- --device`).

First install may require **Settings → General → VPN & Device Management** → trust the developer.

With Metro running on the Mac (`pnpm start`), the debug app on the phone loads JS over the LAN (same Wi‑Fi as the Mac).

---

## 6. Two-account test flow

1. **Phone A:** sign up `user-a@test.com` (use real emails you control if you test Google later).  
2. **Phone B:** sign up `user-b@test.com`.  
3. Complete **profile** on both (`profileComplete` required for matching).  
4. **Phone A:** Send tab → send a plane.  
5. **Phone B:** Home → accept plane → chat.  
6. Send chat messages both ways; keep both apps **foreground** to see WebSocket updates (no push yet).

If matching says **no candidates**, use broad filters (Send has no filter UI yet — defaults match any). Ensure both are real users, not only dummies.

---

## 7. Troubleshooting

| Symptom | Fix |
|---------|-----|
| “Cannot reach the server” | Wrong IP in `.env`, firewall, or not same Wi‑Fi; check `/health` in phone browser |
| Works on Android, not iOS | Rebuild iOS after `.env` change; check Mac IP again |
| Works until you change Wi‑Fi | IP changed — update `.env`, reset Metro cache, rebuild |
| `relation does not exist` | Restart API after `docker compose up`; empty DB needs migration on startup |
| Chat not live on other phone | Both signed in? Open chat thread; WS needs same `SWING_API_URL` host |
| Google sign-in fails | Use **email/password** for local test unless OAuth clients are configured |

---

## 8. Production note

Local setup uses **HTTP** and cleartext on Android for convenience. Before App Store / Play release, use **HTTPS** and turn off cleartext in `network_security_config.xml` / manifests.
