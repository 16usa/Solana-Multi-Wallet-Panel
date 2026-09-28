Withdrawal History v7.4

Adds a persistent WITHDRAWAL HISTORY block at the bottom of the FUNDS sheet.

Stored/displayed:
- source execution wallet
- destination wallet
- actual SOL amount
- MAX flag
- single withdraw vs WITHDRAW ALL
- success / failed status
- Solana transaction signature with Solscan link
- local date/time
- error text for failed attempts

History:
- global FUNDS sheet: latest 30 records across all execution wallets
- per-wallet FUNDS sheet: latest 30 records for that wallet
- new records are stored in PostgreSQL and survive browser refreshes
- successful/failed withdrawal records start being stored after this patch is installed

The installer:
- patches the existing workspace in-place
- creates a small backup folder
- runs the Drizzle DB schema push
- runs typecheck
- DOES NOT restart the server or Replit process
