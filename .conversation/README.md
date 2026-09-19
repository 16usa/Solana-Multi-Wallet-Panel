# Solana Multi Wallet Panel

Minimal white/black Solana multi-wallet dashboard for Replit.

## What it does

- Add any number of **public Solana wallet addresses**.
- Read each wallet's SOL balance.
- Paste and validate an SPL token mint.
- Set a default SOL amount per wallet, with optional per-wallet override.
- Prepare a Pump.fun transaction for Pump mints (bonding curve or PumpSwap), with Jupiter fallback for other Solana tokens.
- Sign and execute an order only when the matching wallet is connected.
- Never stores seed phrases or private keys.

## Important signing behavior

A public address alone cannot authorize a trade. The app prepares an unsigned transaction for each address. To execute a row, connect that exact wallet and approve the signature in the wallet app/extension.

## Replit setup

1. Upload the project (or unzip it into a new Replit project).
2. In **Secrets**, add:
   - `SOLANA_RPC_URL` — strongly recommended for reliable balance reads and Pump.fun transaction submission. If omitted, the public Solana mainnet RPC is used.
   - `JUPITER_API_KEY` — required only for non-Pump.fun tokens routed through Jupiter.
3. In Shell run:

```bash
npm install
npm run dev
```

The server automatically uses Replit's `PORT` environment variable.

## Production

```bash
npm run build
npm start
```

## API flow

The backend first checks whether the mint belongs to Pump.fun. Pump.fun mints use the official `POST https://fun-block.pump.fun/agents/swap` transaction builder, which automatically handles bonding-curve vs PumpSwap state. The signed transaction is then submitted through the configured Solana RPC.

Non-Pump mints fall back to Jupiter Swap API v2 (`/order` -> wallet signature -> `/execute`).

## Security

Do **not** add private keys, seed phrases, or keypair JSON files to the project or Replit Secrets. This project is intentionally designed so transaction authorization remains in the user's wallet.
