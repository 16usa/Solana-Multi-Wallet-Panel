#!/usr/bin/env bash
set -euo pipefail

WEB_PORT="${PORT:-25364}"
API_PORT="${WALLET_API_PORT:-8080}"

echo "Starting wallet web on ${WEB_PORT}; API proxy -> ${API_PORT}"

PORT="$WEB_PORT" \
BASE_PATH="${BASE_PATH:-/}" \
WALLET_API_PORT="$API_PORT" \
exec pnpm --filter @workspace/solana-multi-wallet run dev
