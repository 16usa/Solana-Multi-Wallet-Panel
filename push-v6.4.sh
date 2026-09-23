#!/usr/bin/env bash
set -euo pipefail

git add   artifacts/solana-multi-wallet/src/pages/home.tsx   artifacts/solana-multi-wallet/src/index.css   artifacts/api-server/src/lib/execution-engine.ts   artifacts/api-server/src/routes/execution.ts

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Add compact funds withdrawal menu"
fi

git push
