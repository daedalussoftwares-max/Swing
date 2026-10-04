#!/usr/bin/env bash
# Free port 8081 and start Metro for physical devices (LAN).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIDS="$(lsof -ti :8081 2>/dev/null || true)"
if [[ -n "${PIDS}" ]]; then
  echo "Stopping existing Metro on :8081 (${PIDS})..."
  kill ${PIDS} 2>/dev/null || true
  sleep 1
fi

exec pnpm exec react-native start --host 0.0.0.0
