#!/usr/bin/env bash
# Start local Postgres + Swing API and print the URL for client/.env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
if [[ -z "${IP}" ]]; then
  IP="$(ipconfig getifaddr en1 2>/dev/null || true)"
fi
if [[ -z "${IP}" ]]; then
  IP="YOUR_MAC_LAN_IP"
fi

API_URL="http://${IP}:8080"

echo "=============================================="
echo " Swing local device testing"
echo "=============================================="
echo ""
echo "1) Put this in client/.env:"
echo "   SWING_API_URL=${API_URL}"
echo ""
echo "2) On each phone (same Wi‑Fi), open in browser:"
echo "   ${API_URL}/health"
echo ""
echo "3) Rebuild apps after changing .env (see docs/LOCAL-DEVICE-TESTING.md)"
echo ""

if [[ ! -f "${ROOT}/backend/serving/config/setup/local/dev.local.yaml" ]]; then
  echo "WARNING: missing backend/serving/config/setup/local/dev.local.yaml"
  echo "         cp dev.local.yaml.example and set database.url + jwt_secret"
  echo ""
fi

echo "Starting Postgres (docker compose)..."
(cd "${ROOT}/backend" && docker compose up -d)

echo ""
echo "Starting API on ${API_URL} (Ctrl+C to stop)..."
cd "${ROOT}/backend/serving"
export PROFILE=dev
export SETUP=local
exec go run .
