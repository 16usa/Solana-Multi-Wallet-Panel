#!/usr/bin/env bash
set -euo pipefail

git add   .replit   scripts/run-wallet-web.sh   artifacts/solana-multi-wallet/.replit-artifact/artifact.toml   artifacts/api-server/src/routes/solana.ts   artifacts/api-server/src/lib/execution-engine.ts

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Fix Replit workflows and Solana RPC startup"
fi

git push
