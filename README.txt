Solana Multi Wallet v7.3 — Copy Trading

Included:
- Global COPY TRADING ON/OFF.
- Multiple source Solana wallets.
- Per-source ON/OFF.
- COPY BUY ON/OFF.
- SAME-% SELL ON/OFF.
- No Ratio mode.
- FOLLOW SOURCE mode.
- COPY BUY + AUTO mode.
- Per-execution-wallet selection.
- Fixed BUY amount per selected execution wallet in SOL or USD.
- Per-source MAX BUY cap in SOL or USD.
- Slippage setting.
- Optional delay in milliseconds.
- COPY BUY + AUTO has its own TP / TP SELL / SL / SL SELL settings.
- Duplicate source-signature protection.
- Copy history with COPIED / FAILED / SKIPPED status.
- Execution wallets cannot be added as source wallets.
- Re-enabling master COPY or a source starts from the latest source
  transaction instead of replaying old transactions.

Detection:
- Server polls each enabled source wallet on Solana.
- A source BUY is detected when that source gains one SPL token while its
  native SOL balance decreases.
- A source SELL is detected when that source loses one SPL token while its
  native SOL balance increases.
- Direct token transfers are intentionally not copied.
- Complex multi-token transactions are intentionally ignored instead of guessed.

Modes:
FOLLOW SOURCE
- fixed-size BUY on each selected execution wallet
- source SELL is copied using the same percentage of each target wallet's
  own token balance
- AUTO is disabled for that copied position so it does not fight source exits

COPY BUY + AUTO
- only source BUY is copied
- source SELL is ignored
- target exits use the source's configured TP/SL settings

Important:
- Copy trading can never be perfectly simultaneous with the source.
  RPC confirmation, detection, route building and network latency add delay.
- Slippage is passed directly to Pump.fun swap building. Jupiter-routed
  non-Pump swaps keep Jupiter's route execution behavior.
- Keep the API deployment online continuously for 24/7 operation.

Install:
  unzip -o Solana-Multi-Wallet-v7.3-Copy-Trading.zip
  bash install.sh
  bash push-v7.3.sh

No restart is performed.
After push, restart API Server manually in Replit Console.
Restart the web frontend manually only if it does not hot-reload.
