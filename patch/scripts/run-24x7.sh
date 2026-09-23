#!/usr/bin/env bash
set -euo pipefail
export NODE_ENV=production
export PORT="${PORT:-8080}"
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
