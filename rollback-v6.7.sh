#!/usr/bin/env bash
set -euo pipefail

python3 patch/rollback-v6-7.py

git add artifacts/solana-multi-wallet/src/index.css

if git diff --cached --quiet; then
  echo "Nothing to roll back."
else
  git commit -m "Rollback software palette to v6.6"
  git push
fi

echo
echo "v6.7 palette rolled back and pushed."
echo "No server restart was performed."
echo "No Console commands were run."
