#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import os
from urllib.parse import urlparse

v = os.getenv("SOLANA_RPC_URL", "").strip()
if v.startswith("SOLANA_RPC_URL="):
    v = v[len("SOLANA_RPC_URL="):].strip()
if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
    v = v[1:-1].strip()

try:
    p = urlparse(v)
    ok = p.scheme in ("http", "https") and bool(p.netloc)
except Exception:
    ok = False

print("SOLANA_RPC_URL format:", "OK" if ok else "INVALID")
print("Scheme:", urlparse(v).scheme if v else "missing")
print("Host present:", "YES" if (v and urlparse(v).netloc) else "NO")
PY
