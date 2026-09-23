#!/usr/bin/env bash
set -euo pipefail

FILES=(
  "artifacts/api-server/src/lib/execution-engine.ts"
  "artifacts/api-server/src/routes/solana.ts"
  "artifacts/api-server/src/routes/execution.ts"
  "artifacts/api-server/src/lib/strategy-worker.ts"
  "artifacts/api-server/src/lib/copy-trading-worker.ts"
  "artifacts/solana-multi-wallet/src/pages/home.tsx"
)

git restore -- "${FILES[@]}"
rm -f "artifacts/api-server/src/lib/solana-rpc.ts"

echo "RPC fix rolled back to the current Git HEAD."
echo "Server was NOT restarted."
