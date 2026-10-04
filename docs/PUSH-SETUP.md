# Push notifications setup (Firebase Cloud Messaging)

Swing Android aur iOS dono ke liye **FCM HTTP v1** use karta hai. Code already wired hai; jab tak
neeche wali files add nahi hoti, push **automatically disabled** rehta hai (app aur server normal chalte hain).

| Kya | Value |
|-----|-------|
| Android package name | `com.rahulsaw.swing` (from `client/android/app/build.gradle`) |
| iOS bundle id | `com.rahulsaw.swing` (from `client/ios/swing.xcodeproj`) |
| Android notification channel | `messages` ("Messages", high importance, app start pe create hota hai) |
| Server config key | `push.fcm_service_account_file` (env: `FCM_SERVICE_ACCOUNT_FILE`) |

> **Abhi sirf Android:** steps **1, 2, 5, 6 (sirf `pnpm android`), 7** karo. Steps 3 aur 4 (iOS + APNs)
> skip karo — iOS bina `GoogleService-Info.plist` ke normally chalta hai, bas push off rehta hai.

Saari secret files already `.gitignore` me hain (`google-services.json`, `GoogleService-Info.plist`,
`firebase-service-account*.json`, `*.p8`). Inko kabhi commit mat karna.

---

## 1. Firebase project banao

1. <https://console.firebase.google.com> → **Add project** → naam e.g. `swing` → Google Analytics optional (off bhi chalega).
2. Project ban jaane ke baad **Project settings** (gear icon) kholo.

## 2. Android app add karo

1. Project settings → **Your apps** → Android icon.
2. Package name: **`com.rahulsaw.swing`** (exact). Nickname optional. SHA-1 abhi zaroori nahi.
3. **google-services.json** download karo aur yahan rakho:
   ```
   client/android/app/google-services.json
   ```
4. Baaki "add SDK" steps skip karo — Gradle me already done hai. `app/build.gradle` google-services
   plugin ko sirf tab apply karta hai jab ye file exist kare.

## 3. iOS app add karo

1. Project settings → **Add app** → iOS.
2. Bundle ID: **`com.rahulsaw.swing`**.
3. **GoogleService-Info.plist** download karo → `client/ios/swing/GoogleService-Info.plist` me copy karo.
4. **Xcode target me add karna zaroori hai** (sirf folder me copy karna kaafi nahi):
   - `open client/ios/swing.xcworkspace`
   - Left sidebar me `swing` folder pe right-click → **Add Files to "swing"…** → `GoogleService-Info.plist` select karo
   - "Copy items if needed" ✔, **Target: swing ✔** → Add.
   - Check: file select karke right panel → *Target Membership* me `swing` ticked ho.
5. `AppDelegate.swift` `FirebaseApp.configure()` sirf tab call karta hai jab ye plist bundle me ho.

## 4. APNs key upload karo (iOS push ke liye zaroori)

> Iske liye **paid Apple Developer Program** account chahiye ($99/yr). Free account pe iOS push nahi chalega.

1. <https://developer.apple.com/account/resources/authkeys/list> → **Keys** → **+**.
2. Naam e.g. `Swing APNs`, **Apple Push Notifications service (APNs)** ✔ → Continue → Register.
3. `.p8` file download karo (sirf ek baar download hoti hai — safe rakho, repo me nahi). **Key ID** aur
   apna **Team ID** (Membership page pe) note karo.
4. Firebase → Project settings → **Cloud Messaging** tab → *Apple app configuration* → **APNs Authentication Key** → Upload:
   `.p8` file + Key ID + Team ID.
5. Xcode me signing: `swing` target → *Signing & Capabilities* → apni Team select karo. **Push Notifications**
   capability already hai (`swing/swing.entitlements` me `aps-environment`) aur **Background Modes → Remote notifications**
   `Info.plist` me add hai. Agar Xcode capability missing dikhaye to "+ Capability" se dono add kar do
   (same files update honge).
   - Note: Apple Developer portal pe App ID `com.rahulsaw.swing` pe *Push Notifications* enabled hona chahiye
     (Xcode automatic signing ye khud kar deta hai).

## 5. Backend: service account key

1. Firebase → Project settings → **Service accounts** tab → **Generate new private key** → JSON download hogi.
2. File ko yahan rakho (gitignored):
   ```
   backend/serving/config/setup/local/firebase-service-account.json
   ```
3. `backend/serving/config/setup/local/dev.local.yaml` me add karo:
   ```yaml
   push:
     fcm_service_account_file: "config/setup/local/firebase-service-account.json"
     # fcm_project_id: "optional-override"   # default: JSON ka project_id
   ```
   Ya env var: `FCM_SERVICE_ACCOUNT_FILE=/abs/path/to/key.json` (aur optional `FCM_PROJECT_ID`).
   Relative path `backend/serving` (server ki working dir) se resolve hota hai.
4. Server restart karo. Startup log me dikhna chahiye:
   ```
   push notifications enabled (fcm project=<your-project-id>)
   ```
   File missing/galat ho to `push notifications disabled: ...` aayega aur server normal chalta rahega.
5. Google Cloud console me **Firebase Cloud Messaging API (V1)** enabled hona chahiye (new projects me default on hota hai):
   <https://console.cloud.google.com/apis/library/fcm.googleapis.com>

## 6. Native apps rebuild karo

Firebase native code hai, isliye Metro reload kaafi nahi — full rebuild chahiye:

```bash
cd client
pnpm install
cd ios && LANG=en_US.UTF-8 pod install && cd ..   # "pathname contains null byte" aaye to dobara chalao
pnpm ios            # ya Xcode se Run (real device pe push test karna best hai)
pnpm android        # ya pnpm android:device
```

## 7. Test kaise karein

1. App me sign in karo → permission prompt aayega (iOS, Android 13+) → **Allow**.
   Server log me `POST /v1/devices` 200 dikhega; DB me row:
   ```sql
   SELECT account_id, platform, updated_at FROM device_tokens ORDER BY updated_at DESC LIMIT 5;
   ```
2. Do accounts lo (A, B). B ka app **background** me bhejo (home button) ya kill karo.
   - A se B ko chat message bhejo → B ko "<A ka naam>: message" notification aani chahiye.
     Tap → seedha us chat pe khulta hai.
   - A se plane bhejo jo B ko land ho → "✈️ A paper plane landed!" → tap → plane detail.
   - B plane accept kare (A background me) → A ko "<B> caught your plane ✈️" → tap → chat.
3. App foreground me ho to system notification **nahi** aata (server foreground users ko push nahi karta;
   in-app banner WebSocket se aata hai).
4. Sign out → `DELETE /v1/devices` call hota hai, token row delete ho jaati hai.

### Quick checks / troubleshooting

- **iOS Simulator**: Xcode 14+ / Apple-silicon simulators pe remote push kaam karta hai, lekin real device pe test
  karna zyada reliable hai. Simulator pe manual test: Xcode → Device → *Simulate push* ya
  `xcrun simctl push booted com.rahulsaw.swing payload.apns`.
- Token nahi mil raha (iOS) → APNs key upload hui? Signing team set hai? `aps-environment` entitlement present?
- Server log `push: fcm send rejected http_status=403` → service account galat project ka hai ya FCM API disabled.
- `push: removed invalid device token` normal hai — uninstall/reinstall ke baad purane tokens FCM khud invalid bata deta hai.
- Android pe notification silent aaye → Settings → Apps → Swing → Notifications → "Messages" channel check karo.
  (Channel ek baar ban gaya to importance sirf user change kar sakta hai; dev me app reinstall karke reset hota hai.)

## Kaise kaam karta hai (short)

- Server: `backend/serving/app/cmd/push/fcm.go` — service-account JWT se OAuth token (cached ~1h), recipient ke saare
  `device_tokens` pe parallel send (8s timeout each), `UNREGISTERED`/invalid tokens auto-delete.
  Chat messages (`chats` service) aur plane events (`sideeffects/plane_sink.go`) sirf tab push karte hain jab user ka
  app foreground me nahi hai (WebSocket app-state se pata chalta hai).
- Payload `data`: `type` = `chat_message` | `plane_received` | `plane_accepted` + `chatId` / `planeId` / `messageId`.
  Android: channel `messages`, priority HIGH, tag = chatId. iOS: `thread-id` = chatId, sound default, priority 10.
- Client: `client/components/push-bootstrap.tsx` (permission, token register/refresh, notification taps),
  `client/lib/push/*`, sign-out pe `unregisterPushToken()`.
