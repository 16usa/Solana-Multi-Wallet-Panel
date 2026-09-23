#!/usr/bin/env bash
set -euo pipefail

git add \
  .replit \
  lib/db/src/schema/index.ts \
  lib/db/src/schema/execution.ts \
  artifacts/api-server/src/lib/execution-vault.ts \
  artifacts/api-server/src/lib/execution-engine.ts \
  artifacts/api-server/src/lib/strategy-worker.ts \
  artifacts/api-server/src/routes/execution.ts \
  artifacts/api-server/src/routes/index.ts \
  artifacts/api-server/src/index.ts \
  artifacts/api-server/src/app.ts \
  artifacts/solana-multi-wallet/src/App.tsx \
  artifacts/solana-multi-wallet/src/pages/home.tsx \
  artifacts/solana-multi-wallet/src/index.css \
  scripts/build-24x7.sh \
  scripts/run-24x7.sh

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Add encrypted 24x7 execution wallets and strategy worker"
fi

git push
