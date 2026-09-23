#!/usr/bin/env bash
set -euo pipefail

git add   artifacts/api-server/src/lib/execution-engine.ts   artifacts/solana-multi-wallet/src/pages/home.tsx

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Fix SOL USD currency toggle"
fi

git push
