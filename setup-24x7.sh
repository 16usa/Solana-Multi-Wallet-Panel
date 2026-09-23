#!/usr/bin/env bash
set -euo pipefail

missing=0
for name in DATABASE_URL EXECUTION_MASTER_KEY PANEL_API_TOKEN SOLANA_RPC_URL; do
  if [ -z "${!name:-}" ]; then
    echo "MISSING SECRET: $name"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo
  echo "Add the missing values in Replit Secrets, then run this again."
  exit 1
fi

python3 - <<'PY'
import base64, os
raw = os.environ["EXECUTION_MASTER_KEY"]
try:
    key = base64.b64decode(raw, validate=True)
except Exception:
    raise SystemExit("EXECUTION_MASTER_KEY is not valid base64")
if len(key) != 32:
    raise SystemExit("EXECUTION_MASTER_KEY must decode to exactly 32 bytes")
print("EXECUTION_MASTER_KEY: OK")
PY

pnpm --filter @workspace/db push

echo
echo "Database schema is ready."
echo "No server restart was performed."
