#!/usr/bin/env bash
set -euo pipefail

git add   artifacts/api-server/src/routes/execution.ts   artifacts/api-server/src/lib/execution-engine.ts   artifacts/api-server/src/lib/strategy-worker.ts

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  git commit -m "Coordinate manual trades with AUTO strategy"
fi

git push
