#!/usr/bin/env bash
set -euo pipefail

git add   artifacts/solana-multi-wallet/src/pages/home.tsx   artifacts/solana-multi-wallet/src/index.css

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Add per-wallet buy and sell amounts"
fi

git push
