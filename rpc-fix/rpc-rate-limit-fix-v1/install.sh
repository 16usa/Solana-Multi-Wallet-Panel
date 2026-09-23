#!/usr/bin/env bash
set -euo pipefail

echo "== Solana Multi Wallet RPC Fix v1 =="
echo "No server restart will be performed."

if [ ! -f "package.json" ] || [ ! -d "artifacts/api-server" ]; then
  echo "ERROR: Run this from the existing Solana-Multi-Wallet-Panel workspace root."
  exit 1
fi

PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RPC_TARGET="artifacts/api-server/src/lib/solana-rpc.ts"
BACKUP_DIR="$(mktemp -d)"

TARGETS=(
  "artifacts/api-server/src/lib/execution-engine.ts"
  "artifacts/api-server/src/routes/solana.ts"
  "artifacts/api-server/src/routes/execution.ts"
  "artifacts/api-server/src/lib/strategy-worker.ts"
  "artifacts/api-server/src/lib/copy-trading-worker.ts"
  "artifacts/solana-multi-wallet/src/pages/home.tsx"
)

restore_on_error() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo
    echo "Install failed. Restoring the original files..."
    for file in "${TARGETS[@]}"; do
      if [ -f "$BACKUP_DIR/$file" ]; then
        mkdir -p "$(dirname "$file")"
        cp "$BACKUP_DIR/$file" "$file"
      fi
    done

    if [ -f "$BACKUP_DIR/solana-rpc.ts" ]; then
      cp "$BACKUP_DIR/solana-rpc.ts" "$RPC_TARGET"
    else
      rm -f "$RPC_TARGET"
    fi

    echo "Original files restored."
  fi
  rm -rf "$BACKUP_DIR"
  exit "$status"
}
trap restore_on_error EXIT

for file in "${TARGETS[@]}"; do
  mkdir -p "$BACKUP_DIR/$(dirname "$file")"
  cp "$file" "$BACKUP_DIR/$file"
done

if [ -f "$RPC_TARGET" ]; then
  cp "$RPC_TARGET" "$BACKUP_DIR/solana-rpc.ts"
fi

python3 "$PATCH_DIR/install_patch.py"
cp "$PATCH_DIR/files/solana-rpc.ts" "$RPC_TARGET"

echo
echo "Running backend typecheck..."
pnpm --filter @workspace/api-server run typecheck

echo
echo "Running frontend typecheck..."
pnpm --filter @workspace/solana-multi-wallet run typecheck

trap - EXIT
rm -rf "$BACKUP_DIR"

echo
echo "PATCH INSTALLED SUCCESSFULLY"
echo "Server was NOT restarted."
echo
echo "What changed:"
echo "  - one shared throttled Solana RPC connection"
echo "  - automatic retry/backoff for 429/502/503/504"
echo "  - false 0.0000 balances are no longer shown on RPC failure"
echo "  - state refresh reduced from 5s to 10s"
echo "  - copy worker poll reduced from 1.8s to 5s"
echo "  - strategy worker poll reduced from 5s to 7.5s"
echo "  - transient RPC errors no longer disable AUTO"
echo "  - BUY / BUY ALL checks SOL + 0.005 SOL reserve before sending"
echo "  - BUY ALL now shows the actual failure reason"
echo
echo "Review:"
git diff --stat
echo
echo "Now restart the app manually from the Replit console."
