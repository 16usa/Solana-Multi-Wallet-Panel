#!/usr/bin/env bash
set -euo pipefail

git add   lib/db/src/schema/index.ts   lib/db/src/schema/copy-trading.ts   artifacts/api-server/src/routes/index.ts   artifacts/api-server/src/routes/copy-trading.ts   artifacts/api-server/src/index.ts   artifacts/api-server/src/lib/copy-trading-worker.ts   artifacts/api-server/src/lib/execution-engine.ts   artifacts/solana-multi-wallet/src/pages/home.tsx   artifacts/solana-multi-wallet/src/index.css

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Add 24x7 copy trading"
fi

git push
