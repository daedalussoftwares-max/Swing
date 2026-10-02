# Swing — Postman Collection

Import these two files into Postman:

| File | Purpose |
|------|---------|
| `Swing-API.postman_collection.json` | All API requests |
| `Swing-Local.postman_environment.json` | Variables (base URL, tokens, IDs) |

## Import steps

1. Open Postman → **Import** → drag both JSON files
2. Top-right environment dropdown → select **Swing — Local**
3. Start backend: `cd backend/serving && PROFILE=dev SETUP=local go run .`

## Quick test (solo — dummy match)

Run in order:

1. **Auth → User A → Login User A** (or Register)
2. **Profile → User A → Complete profile (User A)**
3. **Planes → Send plane (User A)**
4. Wait **10 seconds**
5. **Planes → Outbox — sent planes (User A)** → `status: accepted`, `recipientIsDummy: true`

## Two-user test (real accept + chat)

1. **Auth → User A → Register/Login**
2. **Auth → User B → Register/Login**
3. **Profile → User A → Complete profile**
4. **Profile → User B → Complete profile**
5. **Planes → Send plane — female filter (User A)**
6. **Planes → Inbox (User B)** → saves `planeId`
7. **Planes → Accept plane (User B)** → saves `chatId`

## Environment variables

| Variable | Auto-set? | Description |
|----------|-----------|-------------|
| `baseUrl` | Manual | `http://localhost:8080` |
| `userAEmail` / `userAPassword` | Manual | Sender credentials |
| `userBEmail` / `userBPassword` | Manual | Receiver credentials |
| `accessToken` | ✅ Login/Register A | Bearer token User A |
| `refreshToken` | ✅ Login/Register A | Refresh token User A |
| `accountId` | ✅ Login/Register A | User A UUID |
| `accessTokenB` | ✅ Login/Register B | Bearer token User B |
| `accountIdB` | ✅ Login/Register B | User B UUID |
| `username` / `usernameB` | Manual | Profile usernames |
| `planeId` | ✅ Send / Inbox | Last plane UUID |
| `chatId` | ✅ Accept | Chat UUID (real users) |
| `statusId` | ✅ Create status | Status item UUID |

## Collection Runner

Select folder **Planes** or run full collection with environment **Swing — Local**.

Login requests must run first so `accessToken` is populated.
