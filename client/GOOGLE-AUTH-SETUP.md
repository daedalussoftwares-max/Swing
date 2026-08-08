# Google Sign-In setup

Native builds only (`com.rahulsaw.swing` via Xcode / Android Studio). Expo Go is not supported.

---

## 1. OAuth consent screen (fixes "Access blocked")

1. [Google Cloud Console](https://console.cloud.google.com) → your project
2. **APIs & Services → OAuth consent screen**
3. User type: **External**, fill required fields
4. Status: **Testing**
5. **Test users → Add users** → the **exact Gmail** you use on the device
6. Save and wait ~1 minute

---

## 2. OAuth clients

| Client | Type | Bundle / package | Env var |
|--------|------|------------------|---------|
| Web | Web application | — | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` + backend |
| iOS | iOS | **`com.rahulsaw.swing`** | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` |
| Android | Android | **`com.rahulsaw.swing`** + debug SHA-1 | `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` |

Create the **iOS** client with bundle **`com.rahulsaw.swing`** (not `host.exp.Exponent`).

---

## 3. `client/.env`

```env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=....apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=....apps.googleusercontent.com
```

---

## 4. Backend `dev.local.yaml`

iOS native sign-in puts the **iOS client ID** in the token `aud`, not the Web ID:

```yaml
auth:
  google_client_id: "<Web client ID>"
  google_client_ids:
    - "<Web client ID>"
    - "<iOS client ID (com.rahulsaw.swing)>"
    - "<Android client ID>"
```

---

## 5. Android SHA-1 (debug)

```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android 2>/dev/null | grep SHA1
```

Add SHA-1 to the Android OAuth client in Google Cloud.

---

## 6. Restart Metro

```bash
cd client && pnpm start -- --clear
```

---

## User sees vs dev sees

| Situation | User sees | Dev sees (Metro console) |
|-----------|-----------|---------------------------|
| Not configured | Google sign-in is not available… | Missing EXPO_PUBLIC_GOOGLE_* in .env |
| Access blocked | Google sign-in was blocked… | add Test users in OAuth consent screen |
| Wrong bundle | Could not sign in with Google… | use iOS client for com.rahulsaw.swing |
| Other failure | Could not sign in with Google… | raw OAuth detail |
