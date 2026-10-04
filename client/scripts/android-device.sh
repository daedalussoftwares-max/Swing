#!/usr/bin/env bash
# Physical Android: sync Mac IP → .env, wire Metro via adb reverse, run or install debug build.
#
# Usage (from repo root or client/):
#   pnpm android:device          # USB: build + install + launch (needs Metro)
#   pnpm android:device apk      # build APK; install over USB if adb works
#   pnpm android:device check    # network / adb / API / Metro diagnostics only
#
set -euo pipefail

CLIENT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CLIENT_ROOT"

MODE="${1:-run}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

read_api_url() {
  if [[ -f .env ]]; then
    grep -E '^SWING_API_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
  else
    echo ""
  fi
}

sync_lan() {
  node scripts/sync-lan-env.mjs
}

adb_on_path() {
  if command -v adb >/dev/null 2>&1; then
    return 0
  fi
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  if [[ -n "$sdk" && -x "$sdk/platform-tools/adb" ]]; then
    export PATH="$sdk/platform-tools:$PATH"
    return 0
  fi
  if [[ -x /opt/homebrew/share/android-commandlinetools/platform-tools/adb ]]; then
    export PATH="/opt/homebrew/share/android-commandlinetools/platform-tools:$PATH"
    return 0
  fi
  if [[ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]]; then
    export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
    return 0
  fi
  return 1
}

count_adb_devices() {
  adb devices 2>/dev/null | awk 'NR>1 && $2=="device" { c++ } END { print c+0 }'
}

check_api() {
  local url
  url="$(read_api_url)"
  if [[ -z "$url" ]]; then
    yellow "WARN: No SWING_API_URL in client/.env"
    return 1
  fi
  local health="${url%/}/health"
  if curl -sf --connect-timeout 3 "$health" >/dev/null; then
    green "API OK: $health"
    return 0
  fi
  red "API not reachable: $health"
  yellow "  Start on Mac: cd backend/serving && PROFILE=dev SETUP=local go run ."
  yellow "  Phone browser should open the same URL before testing the app."
  return 1
}

check_metro() {
  if curl -sf --connect-timeout 2 http://127.0.0.1:8081/status | grep -q 'packager-status:running'; then
    green "Metro OK: http://127.0.0.1:8081"
    return 0
  fi
  red "Metro is not running on this Mac (port 8081)."
  yellow "  In another terminal: cd client && pnpm start"
  return 1
}

setup_adb_reverse() {
  local n
  n="$(count_adb_devices)"
  if [[ "$n" -eq 0 ]]; then
    return 1
  fi
  adb reverse tcp:8081 tcp:8081
  green "adb reverse: phone localhost:8081 → Mac Metro"
  return 0
}

print_no_adb_help() {
  red "No Android device visible to adb."
  echo ""
  echo "On the phone:"
  echo "  • Settings → About → tap Build number 7× → Developer options"
  echo "  • Enable USB debugging"
  echo "  • USB cable to Mac → allow debugging prompt"
  echo "  • Some OEMs (e.g. vivo): enable 'USB debugging (Security settings)' / OEM unlock"
  echo ""
  echo "On Mac:"
  echo "  • Install platform-tools: Android Studio SDK or brew install android-platform-tools"
  echo "  • Run: adb devices   (must show one line ending in 'device', not 'unauthorized')"
  echo ""
  yellow "If adb never works on this phone, use APK sideload:"
  echo "  pnpm android:device apk"
  echo "  Copy android/app/build/outputs/apk/debug/app-debug.apk to the phone and install."
  echo "  Keep Metro running (pnpm start); same Wi‑Fi as Mac; run pnpm lan:sync after network changes."
}

run_checks() {
  local ok=0
  sync_lan || ok=1
  echo ""
  if adb_on_path; then
    local n
    n="$(count_adb_devices)"
    if [[ "$n" -gt 0 ]]; then
      green "adb: $n device(s) connected"
      setup_adb_reverse || true
    else
      print_no_adb_help
      ok=1
    fi
  else
    red "adb not found (install Android platform-tools)"
    ok=1
  fi
  echo ""
  check_metro || ok=1
  check_api || ok=1
  echo ""
  return "$ok"
}

case "$MODE" in
  check)
    run_checks || exit 1
    green "Checks done. Fix any red items, then: pnpm android:device"
    ;;
  apk)
    sync_lan
    bash scripts/android-apk.sh
    APK="$CLIENT_ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
    echo ""
    if adb_on_path && [[ "$(count_adb_devices)" -gt 0 ]]; then
      adb install -r "$APK"
      green "Installed via adb. Start Metro: pnpm start"
    else
      yellow "Install manually:"
      echo "  $APK"
      yellow "Then: same Wi‑Fi as Mac, Metro running (pnpm start), API on Mac (:8080)."
    fi
    ;;
  run)
    run_checks || {
      yellow "Fix checks above, or use: pnpm android:device apk"
      exit 1
    }
    echo "Building and launching on device..."
    exec pnpm exec react-native run-android
    ;;
  *)
    echo "Usage: pnpm android:device [run|apk|check]"
    exit 1
    ;;
esac
