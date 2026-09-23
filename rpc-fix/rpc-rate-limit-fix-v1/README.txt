Solana Multi Wallet Panel — RPC Rate Limit Fix v1
Target GitHub baseline: main @ eae6605209d36303cc09207e3a54640ac1b5264d

INSTALL (from existing Replit workspace root):
  unzip -o Solana-Multi-Wallet-RPC-Fix-v1.zip -d rpc-fix
  bash rpc-fix/rpc-rate-limit-fix-v1/install.sh

The installer:
- patches the existing project only
- does NOT restart the app
- runs backend + frontend TypeScript typechecks
- automatically restores original files if patching/typecheck fails

After PASS:
1. Restart manually from the Replit console.
2. Test VALIDATE, wallet balances, one BUY, then BUY ALL.
3. For stable 24/7 operation, set a dedicated Solana mainnet RPC URL in Replit Secrets:
   SOLANA_RPC_URL = your dedicated HTTPS RPC endpoint
   Do NOT paste "SOLANA_RPC_URL=" inside the value itself.
4. Optional tuning:
   SOLANA_RPC_MIN_INTERVAL_MS (default public RPC: 300ms; custom RPC: 75ms)
   SOLANA_RPC_MAX_RETRIES (default 3)
   STRATEGY_POLL_MS (minimum/default 7500)
   COPY_TRADING_POLL_MS (minimum/default 5000)

ROLLBACK (before committing):
  bash rpc-fix/rpc-rate-limit-fix-v1/rollback.sh

When the fix is confirmed, commit/push manually:
  git add artifacts/api-server/src/lib/solana-rpc.ts \
          artifacts/api-server/src/lib/execution-engine.ts \
          artifacts/api-server/src/lib/strategy-worker.ts \
          artifacts/api-server/src/lib/copy-trading-worker.ts \
          artifacts/api-server/src/routes/solana.ts \
          artifacts/api-server/src/routes/execution.ts \
          artifacts/solana-multi-wallet/src/pages/home.tsx
  git commit -m "fix: harden Solana RPC execution against rate limits"
  git push origin main
