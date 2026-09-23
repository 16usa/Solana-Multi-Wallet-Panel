import { and, eq } from "drizzle-orm";
import { Keypair } from "@solana/web3.js";
import {
  db,
  executionStrategiesTable,
  executionWalletsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { decryptSecret } from "./execution-vault";
import {
  currentPriceSol,
  executeSellPercent,
} from "./execution-engine";

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick() {
  if (running) return;
  running = true;

  try {
    const rows = await db
      .select({
        strategy: executionStrategiesTable,
        wallet: executionWalletsTable,
      })
      .from(executionStrategiesTable)
      .innerJoin(
        executionWalletsTable,
        eq(
          executionStrategiesTable.walletId,
          executionWalletsTable.id,
        ),
      )
      .where(
        and(
          eq(executionStrategiesTable.enabled, true),
          eq(executionWalletsTable.enabled, true),
        ),
      );

    for (const row of rows) {
      const strategy = row.strategy;
      const wallet = row.wallet;

      if (
        !strategy.entryPriceSol ||
        strategy.entryPriceSol <= 0 ||
        strategy.state === "executing"
      ) {
        continue;
      }

      try {
        const price = await currentPriceSol(strategy.mint);
        const pnl =
          ((price - strategy.entryPriceSol) /
            strategy.entryPriceSol) *
          100;

        let trigger: "tp" | "sl" | null = null;
        let sellPct = 0;

        if (
          !strategy.tpFired &&
          strategy.tpPct > 0 &&
          pnl >= strategy.tpPct
        ) {
          trigger = "tp";
          sellPct = strategy.tpSellPct;
        } else if (
          strategy.slPct > 0 &&
          pnl <= -strategy.slPct
        ) {
          trigger = "sl";
          sellPct = strategy.slSellPct;
        }

        await db
          .update(executionStrategiesTable)
          .set({
            state: trigger ? "triggered" : "watching",
            updatedAt: new Date(),
            lastError: null,
          })
          .where(eq(executionStrategiesTable.id, strategy.id));

        if (!trigger) continue;

        const latestRows = await db
          .select()
          .from(executionStrategiesTable)
          .where(eq(executionStrategiesTable.id, strategy.id))
          .limit(1);

        const latest = latestRows[0];

        if (
          !latest?.enabled ||
          latest.state === "executing"
        ) {
          continue;
        }

        await db
          .update(executionStrategiesTable)
          .set({
            state: "executing",
            lastTrigger: trigger,
            updatedAt: new Date(),
          })
          .where(eq(executionStrategiesTable.id, strategy.id));

        const secret = decryptSecret(wallet.encryptedSecret);
        const keypair = Keypair.fromSecretKey(secret);

        const signature = await executeSellPercent(
          keypair,
          strategy.mint,
          sellPct,
        );

        const fullExit = sellPct >= 100;
        const tpFired = trigger === "tp" ? true : strategy.tpFired;

        await db
          .update(executionStrategiesTable)
          .set({
            enabled:
              trigger === "sl" || fullExit
                ? false
                : strategy.enabled,
            tpFired,
            state:
              trigger === "sl" || fullExit
                ? "closed"
                : "watching",
            lastSignature: signature,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(executionStrategiesTable.id, strategy.id));

        logger.info(
          {
            address: wallet.address,
            mint: strategy.mint,
            trigger,
            sellPct,
            signature,
          },
          "24/7 strategy executed",
        );
      } catch (error) {
        logger.error(
          {
            err: error,
            address: wallet.address,
            mint: strategy.mint,
          },
          "24/7 strategy execution failed",
        );

        await db
          .update(executionStrategiesTable)
          .set({
            enabled: false,
            state: "error",
            lastError:
              error instanceof Error
                ? error.message
                : String(error),
            updatedAt: new Date(),
          })
          .where(eq(executionStrategiesTable.id, strategy.id));
      }
    }
  } catch (error) {
    logger.error({ err: error }, "24/7 worker tick failed");
  } finally {
    running = false;
  }
}

export function startStrategyWorker() {
  if (timer) return;

  logger.info("Starting 24/7 strategy worker");
  void tick();

  timer = setInterval(() => {
    void tick();
  }, 5000);
}
