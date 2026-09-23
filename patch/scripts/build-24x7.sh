#!/usr/bin/env bash
set -euo pipefail
pnpm --filter @workspace/solana-multi-wallet run build
pnpm --filter @workspace/api-server run build
