#!/usr/bin/env bash
set -euo pipefail

git add   lib/db/src/schema/execution.ts   artifacts/api-server/src/lib/execution-engine.ts   artifacts/api-server/src/lib/position-accounting.ts   artifacts/api-server/src/routes/execution.ts   artifacts/api-server/src/lib/strategy-worker.ts   artifacts/solana-multi-wallet/src/pages/home.tsx   artifacts/solana-multi-wallet/src/index.css

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Add realized and unrealized PnL accounting"
fi

git push
