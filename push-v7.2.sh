#!/usr/bin/env bash
set -euo pipefail

git add   artifacts/api-server/src/lib/execution-engine.ts   artifacts/api-server/src/routes/execution.ts   artifacts/solana-multi-wallet/src/pages/home.tsx   artifacts/solana-multi-wallet/src/index.css

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Add global SOL USD currency toggle"
fi

git push
