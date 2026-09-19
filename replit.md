# Solana Multi Wallet Panel

A Vite + React + Express app for monitoring public Solana wallets, validating SPL token mints, and preparing wallet-signed swaps without storing private keys.

## Run & Operate

- `pnpm --filter @workspace/solana-multi-wallet run dev` — run the React frontend through its managed workflow
- `pnpm --filter @workspace/api-server run dev` — run the Express API through its managed workflow
- `pnpm --filter @workspace/solana-multi-wallet run typecheck` — check the frontend
- `pnpm --filter @workspace/api-server run typecheck` — check the backend
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API clients after contract changes
- Optional env: `SOLANA_RPC_URL` — custom mainnet RPC; defaults to Solana's public mainnet endpoint
- Optional env: `JUPITER_API_KEY` — required only for non-Pump.fun swaps routed through Jupiter

## Stack

- pnpm workspace, Node.js 24, TypeScript
- Frontend: Vite, React, Solana wallet adapter
- Backend: Express 5, Solana Web3.js
- Contract: OpenAPI with generated client and Zod validation

## Where things live

- `artifacts/solana-multi-wallet/` — frontend
- `artifacts/api-server/src/routes/solana.ts` — Solana API routes
- `lib/api-spec/openapi.yaml` — API contract

## Architecture decisions

- Wallet addresses are stored only in browser localStorage.
- Transaction signing remains in the connected wallet; the server never receives private keys or seed phrases.
- Pump.fun transaction preparation is preferred for Pump mints, with Jupiter as the optional fallback.

## Product

- Add and monitor public Solana wallet addresses.
- Validate SPL token mint addresses.
- Prepare unsigned per-wallet purchases and submit only wallet-approved signed transactions.

## User preferences

- Preserve the supplied interface without redesigning it.
- Do not add authentication, mock trading data, private keys, seed phrases, or wallet secrets.