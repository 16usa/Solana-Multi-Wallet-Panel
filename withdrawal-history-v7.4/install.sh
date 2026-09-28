#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

python3 "$SCRIPT_DIR/apply.py"

echo
echo "Syncing the new withdrawal-history table to the existing database..."
pnpm --filter @workspace/db push

echo
echo "Running typecheck..."
pnpm run typecheck

echo
echo "DONE: Withdrawal History v7.4 installed."
echo "No server/process restart was performed."
