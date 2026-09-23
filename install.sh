#!/usr/bin/env bash
set -euo pipefail

TARGETS=(
  "lib/db/src/schema/index.ts"
  "artifacts/api-server/src/routes/index.ts"
  "artifacts/api-server/src/index.ts"
  "artifacts/api-server/src/lib/execution-engine.ts"
  "artifacts/solana-multi-wallet/src/pages/home.tsx"
  "artifacts/solana-multi-wallet/src/index.css"
)

for file in "${TARGETS[@]}"; do
  if [ ! -f "$file" ]; then
    echo "ERROR: expected file not found: $file"
    exit 1
  fi
  cp "$file" "$file.bak-v7.3"
done

python3 patch/apply-v7-3.py

echo
echo "Applying copy-trading database schema..."
pnpm --filter @workspace/db push

echo
echo "v7.3 Copy Trading installed."
echo "No server restart was performed."
echo "No Console commands were run."
echo "Run: bash push-v7.3.sh"
