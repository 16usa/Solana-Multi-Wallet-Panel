import { and, eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import {
  db,
  copyTradeControlTable,
  copyTradeEventsTable,
  copyTradeExecutionsTable,
  copyTradeSourcesTable,
  copyTradeTargetsTable,
  executionStrategiesTable,
  executionWalletsTable,
  type CopyTradeSource,
} from "@workspace/db";
import { decryptSecret } from "./execution-vault";
import {
  currentSolUsd,
  executeBuy,
  executeSellPercent,
  executionConnection,
  walletTokenBalance,
} from "./execution-engine";
import {
  recordBuyAccounting,
  recordSellAccounting,
} from "./position-accounting";
import { Keypair } from "@solana/web3.js";
import { logger } from "./logger";

const SOL_EPSILON = 0.00001;
const POLL_MS = 1800;
const WSOL_MINT = "So11111111111111111111111111111111111111112";

type DetectedTrade = {
  mint: string;
  side: "buy" | "sell";
  sellPct: number | null;
};

function amount(balance: any): number {
  const value =
    balance?.uiTokenAmount?.uiAmountString ??
    balance?.uiTokenAmount?.uiAmount ??
    "0";

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ownedTokenBalances(items: readonly any[] | null | undefined, owner: string) {
  const map = new Map<string, number>();

  for (const item of items ?? []) {
    if (String(item?.owner ?? "") !== owner) continue;
    if (!item?.mint || item.mint === WSOL_MINT) continue;

    map.set(
      item.mint,
      (map.get(item.mint) ?? 0) + amount(item),
    );
  }

  return map;
}

async function detectTrade(
  sourceAddress: string,
  signature: string,
): Promise<DetectedTrade | null> {
  const tx = await executionConnection.getParsedTransaction(
    signature,
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  );

  if (!tx?.meta || tx.meta.err) return null;

  const keys = tx.transaction.message.accountKeys;
  const ownerIndex = keys.findIndex(
    (item) => item.pubkey.toBase58() === sourceAddress,
  );

  if (ownerIndex < 0) return null;

  const beforeLamports = tx.meta.preBalances[ownerIndex];
  const afterLamports = tx.meta.postBalances[ownerIndex];

  if (
    beforeLamports == null ||
    afterLamports == null
  ) {
    return null;
  }

  const solDelta =
    (afterLamports - beforeLamports) / 1_000_000_000;

  const pre = ownedTokenBalances(
    tx.meta.preTokenBalances,
    sourceAddress,
  );

  const post = ownedTokenBalances(
    tx.meta.postTokenBalances,
    sourceAddress,
  );

  const mints = new Set([...pre.keys(), ...post.keys()]);
  const deltas = [...mints].map((mint) => ({
    mint,
    before: pre.get(mint) ?? 0,
    after: post.get(mint) ?? 0,
    delta: (post.get(mint) ?? 0) - (pre.get(mint) ?? 0),
  }));

  if (solDelta < -SOL_EPSILON) {
    const buys = deltas
      .filter((item) => item.delta > 0)
      .sort((a, b) => b.delta - a.delta);

    if (buys.length === 1) {
      return {
        mint: buys[0].mint,
        side: "buy",
        sellPct: null,
      };
    }
  }

  if (solDelta > SOL_EPSILON) {
    const sells = deltas
      .filter((item) => item.delta < 0 && item.before > 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    if (sells.length === 1) {
      return {
        mint: sells[0].mint,
        side: "sell",
        sellPct: Math.min(
          100,
          Math.max(
            0,
            (Math.abs(sells[0].delta) / sells[0].before) * 100,
          ),
        ),
      };
    }
  }

  return null;
}

async function findStrategy(walletId: string, mint: string) {
  const rows = await db
    .select()
    .from(executionStrategiesTable)
    .where(
      and(
        eq(executionStrategiesTable.walletId, walletId),
        eq(executionStrategiesTable.mint, mint),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function amountToSol(
  value: number,
  currency: string,
  solUsd: number | null,
) {
  if (currency === "usd") {
    const rate = solUsd ?? await currentSolUsd();
    return value / rate;
  }

  return value;
}

async function processDetectedTrade(
  source: CopyTradeSource,
  sourceSignature: string,
  trade: DetectedTrade,
) {
  if (trade.side === "buy" && !source.copyBuys) return;
  if (trade.side === "sell" && !source.copySells) return;
  if (trade.side === "sell" && source.mode === "copy-buy-auto") return;

  const inserted = await db
    .insert(copyTradeEventsTable)
    .values({
      sourceId: source.id,
      sourceAddress: source.address,
      sourceSignature,
      mint: trade.mint,
      side: trade.side,
      sourceSellPct: trade.sellPct,
      status: "detected",
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  const event = inserted[0];
  if (!event) return;

  const targets = await db
    .select()
    .from(copyTradeTargetsTable)
    .where(
      and(
        eq(copyTradeTargetsTable.sourceId, source.id),
        eq(copyTradeTargetsTable.enabled, true),
      ),
    );

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let cachedSolUsd: number | null = null;

  for (const target of targets) {
    const walletRows = await db
      .select()
      .from(executionWalletsTable)
      .where(eq(executionWalletsTable.id, target.walletId))
      .limit(1);

    const wallet = walletRows[0];

    if (!wallet?.enabled) {
      skipped += 1;
      await db.insert(copyTradeExecutionsTable).values({
        eventId: event.id,
        walletId: target.walletId,
        walletAddress: wallet?.address ?? "unknown",
        status: "skipped",
        error: "Execution wallet is disabled",
      });
      continue;
    }

    if (source.delayMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(15000, source.delayMs)),
      );
    }

    try {
      const keypair = Keypair.fromSecretKey(
        decryptSecret(wallet.encryptedSecret),
      );

      const strategy = await findStrategy(wallet.id, trade.mint);

      if (strategy?.state === "executing") {
        throw new Error(
          "AUTO/manual execution is already running for this position",
        );
      }

      if (trade.side === "buy") {
        if (
          target.buyCurrency === "usd" ||
          source.maxBuyCurrency === "usd"
        ) {
          cachedSolUsd = cachedSolUsd ?? await currentSolUsd();
        }

        const requestedSol = await amountToSol(
          target.buyAmount,
          target.buyCurrency,
          cachedSolUsd,
        );

        const maxSol = await amountToSol(
          source.maxBuyAmount,
          source.maxBuyCurrency,
          cachedSolUsd,
        );

        const buySol = Math.min(requestedSol, maxSol);

        if (!Number.isFinite(buySol) || buySol <= 0) {
          throw new Error("Invalid copy BUY amount");
        }

        const beforeBalance = await walletTokenBalance(
          wallet.address,
          trade.mint,
        );

        const signature = await executeBuy(
          keypair,
          trade.mint,
          buySol,
          source.slippagePct,
        );

        await recordBuyAccounting({
          walletId: wallet.id,
          address: wallet.address,
          mint: trade.mint,
          amountSol: buySol,
          beforeBalance,
          previousStrategy: strategy,
        });

        if (source.mode === "copy-buy-auto") {
          await db
            .update(executionStrategiesTable)
            .set({
              enabled: true,
              tpPct: source.autoTpPct,
              tpSellPct: source.autoTpSellPct,
              slPct: source.autoSlPct,
              slSellPct: source.autoSlSellPct,
              state: "watching",
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(executionStrategiesTable.walletId, wallet.id),
                eq(executionStrategiesTable.mint, trade.mint),
              ),
            );
        } else {
          await db
            .update(executionStrategiesTable)
            .set({
              enabled: false,
              state: "idle",
              lastError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(executionStrategiesTable.walletId, wallet.id),
                eq(executionStrategiesTable.mint, trade.mint),
              ),
            );
        }

        await db.insert(copyTradeExecutionsTable).values({
          eventId: event.id,
          walletId: wallet.id,
          walletAddress: wallet.address,
          status: "copied",
          amountSol: buySol,
          signature,
          updatedAt: new Date(),
        });

        ok += 1;
      } else {
        const sellPct = trade.sellPct ?? 0;

        if (sellPct <= 0) {
          throw new Error("Source SELL percentage could not be determined");
        }

        const beforeBalance = await walletTokenBalance(
          wallet.address,
          trade.mint,
        );

        if (beforeBalance <= 0) {
          skipped += 1;
          await db.insert(copyTradeExecutionsTable).values({
            eventId: event.id,
            walletId: wallet.id,
            walletAddress: wallet.address,
            status: "skipped",
            sellPct,
            error: "Wallet has no balance of the source token",
          });
          continue;
        }

        if (strategy?.enabled) {
          await db
            .update(executionStrategiesTable)
            .set({
              state: "executing",
              updatedAt: new Date(),
            })
            .where(eq(executionStrategiesTable.id, strategy.id));
        }

        const signature = await executeSellPercent(
          keypair,
          trade.mint,
          sellPct,
          source.slippagePct,
        );

        await recordSellAccounting({
          strategy,
          address: wallet.address,
          mint: trade.mint,
          beforeBalance,
          percentage: sellPct,
          signature,
          trigger: "copy-source-sell",
          forceDisable: false,
        });

        await db.insert(copyTradeExecutionsTable).values({
          eventId: event.id,
          walletId: wallet.id,
          walletAddress: wallet.address,
          status: "copied",
          sellPct,
          signature,
          updatedAt: new Date(),
        });

        ok += 1;
      }
    } catch (error) {
      failed += 1;

      await db.insert(copyTradeExecutionsTable).values({
        eventId: event.id,
        walletId: target.walletId,
        walletAddress: wallet.address,
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        updatedAt: new Date(),
      });

      logger.error(
        {
          err: error,
          source: source.address,
          target: wallet.address,
          mint: trade.mint,
          side: trade.side,
        },
        "Copy trade execution failed",
      );
    }
  }

  const status =
    ok > 0 && failed === 0
      ? "completed"
      : ok > 0
        ? "partial"
        : failed > 0
          ? "failed"
          : "skipped";

  await db
    .update(copyTradeEventsTable)
    .set({
      status,
      error:
        failed > 0
          ? `${failed} target(s) failed; ${skipped} skipped`
          : skipped > 0
            ? `${skipped} target(s) skipped`
            : null,
      updatedAt: new Date(),
    })
    .where(eq(copyTradeEventsTable.id, event.id));
}

async function pollSource(source: CopyTradeSource) {
  let sourceKey: PublicKey;

  try {
    sourceKey = new PublicKey(source.address);
  } catch {
    return;
  }

  const signatures = await executionConnection.getSignaturesForAddress(
    sourceKey,
    { limit: 25 },
    "confirmed",
  );

  if (signatures.length === 0) return;

  if (!source.lastSignature) {
    await db
      .update(copyTradeSourcesTable)
      .set({
        lastSignature: signatures[0].signature,
        updatedAt: new Date(),
      })
      .where(eq(copyTradeSourcesTable.id, source.id));
    return;
  }

  const pending = [];

  for (const item of signatures) {
    if (item.signature === source.lastSignature) break;
    pending.push(item);
  }

  for (const item of pending.reverse()) {
    try {
      const trade = await detectTrade(
        source.address,
        item.signature,
      );

      if (trade) {
        await processDetectedTrade(
          source,
          item.signature,
          trade,
        );
      }
    } catch (error) {
      logger.error(
        {
          err: error,
          source: source.address,
          signature: item.signature,
        },
        "Copy trade source transaction failed",
      );
    }

    await db
      .update(copyTradeSourcesTable)
      .set({
        lastSignature: item.signature,
        updatedAt: new Date(),
      })
      .where(eq(copyTradeSourcesTable.id, source.id));
  }
}

let running = false;

async function tick() {
  if (running) return;
  running = true;

  try {
    const controlRows = await db
      .select()
      .from(copyTradeControlTable)
      .where(eq(copyTradeControlTable.id, "global"))
      .limit(1);

    if (!controlRows[0]?.enabled) return;

    const sources = await db
      .select()
      .from(copyTradeSourcesTable)
      .where(eq(copyTradeSourcesTable.enabled, true));

    for (const source of sources) {
      try {
        await pollSource(source);
      } catch (error) {
        logger.error(
          { err: error, source: source.address },
          "Copy source poll failed",
        );
      }
    }
  } finally {
    running = false;
  }
}

export function startCopyTradingWorker() {
  void tick();
  setInterval(() => void tick(), POLL_MS);
}
