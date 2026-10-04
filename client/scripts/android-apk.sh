#!/usr/bin/env bash
set -euo pipefail
CLIENT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CLIENT_ROOT"

if ! node -e "require.resolve('@react-native/gradle-plugin/package.json')" 2>/dev/null; then
  echo "Missing @react-native/gradle-plugin. Run: cd client && pnpm install"
  exit 1
fi

ANDROID_DIR="$CLIENT_ROOT/android"
LOCAL_PROPS="$ANDROID_DIR/local.properties"

resolve_android_sdk() {
  if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]]; then
    echo "$ANDROID_HOME"
    return 0
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "$ANDROID_SDK_ROOT" ]]; then
    echo "$ANDROID_SDK_ROOT"
    return 0
  fi
  local default="$HOME/Library/Android/sdk"
  if [[ -d "$default" ]]; then
    echo "$default"
    return 0
  fi
  local brew_sdk="/opt/homebrew/share/android-commandlinetools"
  if [[ -d "$brew_sdk/cmdline-tools" ]]; then
    echo "$brew_sdk"
    return 0
  fi
  return 1
}

if SDK="$(resolve_android_sdk)"; then
  export ANDROID_HOME="$SDK"
  export ANDROID_SDK_ROOT="$SDK"
  printf 'sdk.dir=%s\n' "$SDK" > "$LOCAL_PROPS"
  echo "Using Android SDK: $SDK"
else
  echo ""
  echo "Android SDK not found."
  echo "1) Install Android Studio: https://developer.android.com/studio"
  echo "2) Open it → SDK Manager → install Android SDK (API 36)"
  echo "3) Add to ~/.zshrc:  export ANDROID_HOME=\"\$HOME/Library/Android/sdk\""
  echo "   Or create $LOCAL_PROPS with:  sdk.dir=/path/to/Android/sdk"
  echo ""
  exit 1
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
  if /usr/libexec/java_home -v 17 &>/dev/null; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  elif [[ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  elif [[ -d /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
    export JAVA_HOME="/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
  else
    echo "No Java 17 found. Install: brew install openjdk@17"
    echo "Then: export JAVA_HOME=\"\$(/usr/libexec/java_home -v 17)\""
    exit 1
  fi
fi

export PATH="$JAVA_HOME/bin:$PATH"

# Gradle/Java honor HTTP/SOCKS proxy env vars. Stale Cursor/VPN proxies on
# 127.0.0.1 cause "Connection refused" when downloading the Gradle distro.
unset ALL_PROXY all_proxy HTTP_PROXY http_proxy HTTPS_PROXY https_proxy
unset GIT_HTTP_PROXY GIT_HTTPS_PROXY SOCKS_PROXY socks_proxy SOCKS5_PROXY socks5_proxy
unset NO_PROXY no_proxy
# Stale empty proxy JVM flags from the shell break SDK downloads (BindException).
unset JAVA_TOOL_OPTIONS
export JAVA_TOOL_OPTIONS="-Djava.net.useSystemProxies=false"

# Gradle autolinking / composite build need node on PATH (nvm/fnm often missing in Gradle daemon).
if [[ -z "${NODE_BINARY:-}" ]]; then
  if [[ -x "/opt/homebrew/bin/node" ]]; then
    export NODE_BINARY="/opt/homebrew/bin/node"
  elif [[ -x "/usr/local/bin/node" ]]; then
    export NODE_BINARY="/usr/local/bin/node"
  elif command -v node >/dev/null 2>&1; then
    export NODE_BINARY="$(command -v node)"
  fi
fi
if [[ -n "${NODE_BINARY:-}" ]]; then
  export PATH="$(dirname "$NODE_BINARY"):$PATH"
fi

bootstrap_gradle_wrapper() {
  local ver="8.14.3"
  local url="https://services.gradle.org/distributions/gradle-${ver}-bin.zip"
  local zipname="gradle-${ver}-bin.zip"
  local root="${GRADLE_USER_HOME:-$HOME/.gradle}/wrapper/dists/gradle-${ver}-bin"
  if find "$root" -name "$zipname" -size +50M 2>/dev/null | grep -q .; then
    return 0
  fi
  local dir
  dir="$(find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)"
  if [[ -z "$dir" ]]; then
    mkdir -p "$root/_manual"
    dir="$root/_manual"
  fi
  rm -f "$dir/"*.lck "$dir/"*.part 2>/dev/null || true
  echo "Downloading Gradle ${ver} with curl (Java proxy workaround)..."
  curl -fL --retry 3 -o "$dir/$zipname" "$url"
}

echo "Using JAVA_HOME=$JAVA_HOME"
java -version
cd "$ANDROID_DIR"
bootstrap_gradle_wrapper

# Gradle often skips rebundling when only client/.env changed — APK keeps the old API URL.
echo "Clearing cached JS bundle (picks up latest client/.env)..."
rm -rf "$ANDROID_DIR/app/build/generated/assets"
rm -rf "$ANDROID_DIR/app/build/intermediates/assets"
rm -rf "$ANDROID_DIR/app/build/intermediates/compressed_assets"
rm -rf "$ANDROID_DIR/app/build/intermediates/sourcemaps/react"

./gradlew assembleDebug -Pswing.bundleDebugApk=true
echo ""
echo "APK: $(cd .. && pwd)/android/app/build/outputs/apk/debug/app-debug.apk"
