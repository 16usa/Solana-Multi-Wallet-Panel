#!/usr/bin/env bash
set -euo pipefail

git add artifacts/solana-multi-wallet/src/index.css

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Refine trading panel software palette"
fi

git push
