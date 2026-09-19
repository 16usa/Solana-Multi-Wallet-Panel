#!/usr/bin/env bash
set -euo pipefail

WEB_PORT="${PORT:-25364}"
API_PORT="${WALLET_API_PORT:-25365}"

echo "Building wallet API..."
pnpm --filter @workspace/api-server run build

echo "Starting wallet API on ${API_PORT}..."
PORT="$API_PORT" NODE_ENV=development \
  node --enable-source-maps artifacts/api-server/dist/index.mjs &
API_PID=$!

cleanup() {
  if kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting wallet web on ${WEB_PORT}..."
PORT="$WEB_PORT" \
BASE_PATH="${BASE_PATH:-/}" \
WALLET_API_PORT="$API_PORT" \
pnpm --filter @workspace/solana-multi-wallet run dev
