#!/usr/bin/env bash
set -euo pipefail

git add   .replit   artifacts/solana-multi-wallet/vite.config.ts   artifacts/solana-multi-wallet/.replit-artifact/artifact.toml

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Fix frontend workflow startup"
fi

git push
