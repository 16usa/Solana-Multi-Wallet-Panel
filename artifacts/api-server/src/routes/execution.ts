import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import {
  db,
  executionStrategiesTable,
  executionWalletsTable,
} from "@workspace/db";
import { encryptSecret, decryptSecret } from "../lib/execution-vault";
import {
  currentPriceSol,
  executeBuy,
  executeSellPercent,
  walletSolBalance,
  walletTokenBalance,
  withdrawSol,
  walletDeletionState,
} from "../lib/execution-engine";

const router: IRouter = Router();

function authorized(value: string | undefined): boolean {
  const expected = process.env.PANEL_API_TOKEN;
  if (!expected || !value?.startsWith("Bearer ")) return false;

  const actual = value.slice("Bearer ".length);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  if (!authorized(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

async function findWallet(address: string) {
  const rows = await db
    .select()
    .from(executionWalletsTable)
    .where(eq(executionWalletsTable.address, address))
    .limit(1);

  return rows[0] ?? null;
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

async function lockStrategyForManualTrade(
  walletId: string,
  mint: string,
) {
  const strategy = await findStrategy(walletId, mint);

  if (!strategy?.enabled) {
    return strategy;
  }

  if (strategy.state === "executing") {
    throw new Error(
      "AUTO is executing for this wallet. Retry the manual trade in a moment.",
    );
  }

  await db
    .update(executionStrategiesTable)
    .set({
      state: "executing",
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(executionStrategiesTable.id, strategy.id));

  return strategy;
}

async function restoreStrategyAfterManualFailure(
  strategy: Awaited<ReturnType<typeof findStrategy>>,
  error: unknown,
) {
  if (!strategy?.enabled) return;

  await db
    .update(executionStrategiesTable)
    .set({
      state: "watching",
      lastError:
        error instanceof Error
          ? error.message
          : String(error),
      updatedAt: new Date(),
    })
    .where(eq(executionStrategiesTable.id, strategy.id));
}

async function finishManualSell(
  strategy: Awaited<ReturnType<typeof findStrategy>>,
  percentage: number,
  signature: string,
) {
  if (!strategy) return;

  const fullExit = percentage >= 100;

  await db
    .update(executionStrategiesTable)
    .set({
      enabled: fullExit ? false : strategy.enabled,
      entryPriceSol: fullExit
        ? null
        : strategy.entryPriceSol,
      tpFired: fullExit
        ? false
        : strategy.tpFired,
      state: fullExit
        ? "closed"
        : strategy.enabled
          ? "watching"
          : "idle",
      lastTrigger: "manual-sell",
      lastSignature: signature,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(executionStrategiesTable.id, strategy.id));
}

async function tokenBalanceAfterBuy(
  address: string,
  mint: string,
  beforeBalance: number,
): Promise<number> {
  let latest = beforeBalance;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    latest = await walletTokenBalance(address, mint);
    if (latest > beforeBalance) return latest;

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  return latest;
}

async function updateWeightedEntryAfterBuy(
  walletId: string,
  address: string,
  mint: string,
  amountSol: number,
  beforeBalance: number,
  previousStrategy: Awaited<ReturnType<typeof findStrategy>>,
) {
  const afterBalance = await tokenBalanceAfterBuy(
    address,
    mint,
    beforeBalance,
  );

  const acquired = Math.max(0, afterBalance - beforeBalance);

  let entryPriceSol: number;

  if (acquired > 0) {
    if (
      beforeBalance > 0 &&
      previousStrategy?.entryPriceSol &&
      previousStrategy.entryPriceSol > 0
    ) {
      const priorCost =
        beforeBalance * previousStrategy.entryPriceSol;

      entryPriceSol =
        (priorCost + amountSol) / afterBalance;
    } else if (beforeBalance <= 0) {
      entryPriceSol = amountSol / acquired;
    } else {
      const current = await currentPriceSol(mint);
      const estimatedPriorCost = beforeBalance * current;
      entryPriceSol =
        (estimatedPriorCost + amountSol) / afterBalance;
    }
  } else {
    entryPriceSol = await currentPriceSol(mint);
  }

  if (!Number.isFinite(entryPriceSol) || entryPriceSol <= 0) {
    throw new Error("Could not calculate the weighted entry price");
  }

  const enabled = previousStrategy?.enabled ?? false;

  await db
    .insert(executionStrategiesTable)
    .values({
      walletId,
      mint,
      enabled,
      entryPriceSol,
      tpFired: false,
      state: enabled ? "watching" : "idle",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        executionStrategiesTable.walletId,
        executionStrategiesTable.mint,
      ],
      set: {
        entryPriceSol,
        tpFired: false,
        state: enabled ? "watching" : "idle",
        lastTrigger: null,
        lastSignature: null,
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

router.get("/execution/wallets", async (_req, res): Promise<void> => {
  const wallets = await db
    .select()
    .from(executionWalletsTable);

  const result = await Promise.all(
    wallets.map(async (wallet) => {
      let sol = 0;
      try {
        sol = await walletSolBalance(wallet.address);
      } catch {
        sol = 0;
      }

      return {
        id: wallet.id,
        address: wallet.address,
        enabled: wallet.enabled,
        sol,
        createdAt: wallet.createdAt,
      };
    }),
  );

  res.json({ wallets: result });
});

router.post("/execution/wallets", async (_req, res): Promise<void> => {
  const keypair = Keypair.generate();

  const inserted = await db
    .insert(executionWalletsTable)
    .values({
      address: keypair.publicKey.toBase58(),
      encryptedSecret: encryptSecret(keypair.secretKey),
      enabled: true,
    })
    .returning({
      id: executionWalletsTable.id,
      address: executionWalletsTable.address,
      enabled: executionWalletsTable.enabled,
      createdAt: executionWalletsTable.createdAt,
    });

  res.status(201).json({
    ...inserted[0],
    sol: 0,
  });
});

router.get("/execution/state", async (req, res): Promise<void> => {
  const mint =
    typeof req.query.mint === "string"
      ? req.query.mint.trim()
      : "";

  if (!mint) {
    res.status(400).json({ error: "mint is required" });
    return;
  }

  let priceSol: number | null = null;
  let priceError: string | null = null;

  try {
    priceSol = await currentPriceSol(mint);
  } catch (error) {
    priceError =
      error instanceof Error ? error.message : String(error);
  }

  const wallets = await db
    .select()
    .from(executionWalletsTable);

  const strategies = await db
    .select()
    .from(executionStrategiesTable)
    .where(eq(executionStrategiesTable.mint, mint));

  const strategyByWallet = new Map(
    strategies.map((strategy) => [
      strategy.walletId,
      strategy,
    ]),
  );

  const rows = await Promise.all(
    wallets.map(async (wallet) => {
      let sol = 0;
      try {
        sol = await walletSolBalance(wallet.address);
      } catch {
        sol = 0;
      }

      const strategy = strategyByWallet.get(wallet.id) ?? null;
      const pnl =
        strategy?.entryPriceSol &&
        priceSol != null
          ? ((priceSol - strategy.entryPriceSol) /
              strategy.entryPriceSol) *
            100
          : null;

      return {
        id: wallet.id,
        address: wallet.address,
        enabled: wallet.enabled,
        sol,
        strategy,
        pnl,
      };
    }),
  );

  res.json({
    mint,
    priceSol,
    priceError,
    wallets: rows,
  });
});

router.post("/execution/strategy", async (req, res): Promise<void> => {
  const {
    address,
    mint,
    enabled,
    tpPct,
    tpSellPct,
    slPct,
    slSellPct,
  } = req.body ?? {};

  if (
    typeof address !== "string" ||
    typeof mint !== "string" ||
    typeof enabled !== "boolean"
  ) {
    res.status(400).json({ error: "Invalid strategy request" });
    return;
  }

  try {
    new PublicKey(address);
    new PublicKey(mint);
  } catch {
    res.status(400).json({ error: "Invalid Solana address" });
    return;
  }

  const numbers = [
    Number(tpPct),
    Number(tpSellPct),
    Number(slPct),
    Number(slSellPct),
  ];

  if (
    numbers.some((value) => !Number.isFinite(value)) ||
    Number(tpPct) <= 0 ||
    Number(slPct) <= 0 ||
    Number(tpSellPct) <= 0 ||
    Number(tpSellPct) > 100 ||
    Number(slSellPct) <= 0 ||
    Number(slSellPct) > 100
  ) {
    res.status(400).json({ error: "Invalid TP/SL percentages" });
    return;
  }

  const wallet = await findWallet(address);
  if (!wallet) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  if (enabled && !wallet.enabled) {
    res.status(409).json({
      error: "Enable the execution wallet before enabling AUTO",
    });
    return;
  }

  const inserted = await db
    .insert(executionStrategiesTable)
    .values({
      walletId: wallet.id,
      mint,
      enabled,
      tpPct: Number(tpPct),
      tpSellPct: Number(tpSellPct),
      slPct: Number(slPct),
      slSellPct: Number(slSellPct),
      state: enabled ? "watching" : "idle",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        executionStrategiesTable.walletId,
        executionStrategiesTable.mint,
      ],
      set: {
        enabled,
        tpPct: Number(tpPct),
        tpSellPct: Number(tpSellPct),
        slPct: Number(slPct),
        slSellPct: Number(slSellPct),
        state: enabled ? "watching" : "idle",
        updatedAt: new Date(),
        lastError: null,
      },
    })
    .returning();

  res.json({ strategy: inserted[0] });
});

router.post("/execution/trade", async (req, res): Promise<void> => {
  const {
    address,
    mint,
    side,
    amountSol,
    sellPct,
  } = req.body ?? {};

  if (
    typeof address !== "string" ||
    typeof mint !== "string" ||
    (side !== "buy" && side !== "sell")
  ) {
    res.status(400).json({ error: "Invalid trade request" });
    return;
  }

  const wallet = await findWallet(address);
  if (!wallet || !wallet.enabled) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  let strategy:
    Awaited<ReturnType<typeof findStrategy>> = null;

  try {
    strategy = await lockStrategyForManualTrade(
      wallet.id,
      mint,
    );

    const keypair = Keypair.fromSecretKey(
      decryptSecret(wallet.encryptedSecret),
    );

    let signature: string;

    if (side === "buy") {
      const amount = Number(amountSol);
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({ error: "Invalid SOL amount" });
        return;
      }

      const beforeBalance = await walletTokenBalance(
        address,
        mint,
      );

      signature = await executeBuy(keypair, mint, amount);

      try {
        await updateWeightedEntryAfterBuy(
          wallet.id,
          address,
          mint,
          amount,
          beforeBalance,
          strategy,
        );
      } catch (trackingError) {
        req.log.error(
          { err: trackingError, address, mint, signature },
          "Trade succeeded but weighted entry tracking failed",
        );

        if (strategy?.enabled) {
          await db
            .update(executionStrategiesTable)
            .set({
              state: "watching",
              lastError:
                trackingError instanceof Error
                  ? trackingError.message
                  : String(trackingError),
              updatedAt: new Date(),
            })
            .where(
              eq(
                executionStrategiesTable.id,
                strategy.id,
              ),
            );
        }
      }
    } else {
      const percentage = Number(sellPct);

      if (
        !Number.isFinite(percentage) ||
        percentage <= 0 ||
        percentage > 100
      ) {
        res.status(400).json({
          error: "Sell percentage must be between 0 and 100",
        });
        return;
      }

      signature = await executeSellPercent(
        keypair,
        mint,
        percentage,
      );

      await finishManualSell(
        strategy,
        percentage,
        signature,
      );
    }

    res.json({
      status: "success",
      side,
      address,
      mint,
      signature,
    });
  } catch (error) {
    await restoreStrategyAfterManualFailure(
      strategy,
      error,
    );

    req.log.error({ err: error }, "Managed trade failed");
    res.status(422).json({
      error:
        error instanceof Error
          ? error.message
          : "Trade failed",
    });
  }
});

router.post("/execution/trade-all", async (req, res): Promise<void> => {
  const { mint, side, amountSol, sellPct } = req.body ?? {};

  if (
    typeof mint !== "string" ||
    (side !== "buy" && side !== "sell")
  ) {
    res.status(400).json({ error: "Invalid trade-all request" });
    return;
  }

  const buyAmount = Number(amountSol);
  const sellPercentage = Number(sellPct);

  if (
    side === "buy" &&
    (!Number.isFinite(buyAmount) || buyAmount <= 0)
  ) {
    res.status(400).json({ error: "Invalid SOL amount" });
    return;
  }

  if (
    side === "sell" &&
    (
      !Number.isFinite(sellPercentage) ||
      sellPercentage <= 0 ||
      sellPercentage > 100
    )
  ) {
    res.status(400).json({
      error: "Sell percentage must be between 0 and 100",
    });
    return;
  }

  const wallets = await db
    .select()
    .from(executionWalletsTable)
    .where(eq(executionWalletsTable.enabled, true));

  const results: Array<Record<string, unknown>> = [];

  for (const wallet of wallets) {
    let strategy:
      Awaited<ReturnType<typeof findStrategy>> = null;

    try {
      strategy = await lockStrategyForManualTrade(
        wallet.id,
        mint,
      );

      const keypair = Keypair.fromSecretKey(
        decryptSecret(wallet.encryptedSecret),
      );

      let signature: string;

      if (side === "buy") {
        const beforeBalance = await walletTokenBalance(
          wallet.address,
          mint,
        );

        signature = await executeBuy(
          keypair,
          mint,
          buyAmount,
        );

        try {
          await updateWeightedEntryAfterBuy(
            wallet.id,
            wallet.address,
            mint,
            buyAmount,
            beforeBalance,
            strategy,
          );
        } catch (trackingError) {
          req.log.error(
            {
              err: trackingError,
              address: wallet.address,
              mint,
              signature,
            },
            "BUY ALL trade succeeded but weighted entry tracking failed",
          );

          if (strategy?.enabled) {
            await db
              .update(executionStrategiesTable)
              .set({
                state: "watching",
                lastError:
                  trackingError instanceof Error
                    ? trackingError.message
                    : String(trackingError),
                updatedAt: new Date(),
              })
              .where(
                eq(
                  executionStrategiesTable.id,
                  strategy.id,
                ),
              );
          }
        }
      } else {
        signature = await executeSellPercent(
          keypair,
          mint,
          sellPercentage,
        );

        await finishManualSell(
          strategy,
          sellPercentage,
          signature,
        );
      }

      results.push({
        address: wallet.address,
        ok: true,
        signature,
      });
    } catch (error) {
      await restoreStrategyAfterManualFailure(
        strategy,
        error,
      );

      results.push({
        address: wallet.address,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  res.json({ results });
});


router.post("/execution/withdraw", async (req, res): Promise<void> => {
  const { address, to, amountSol, max } = req.body ?? {};

  if (
    typeof address !== "string" ||
    typeof to !== "string" ||
    typeof max !== "boolean"
  ) {
    res.status(400).json({ error: "Invalid withdrawal request" });
    return;
  }

  try {
    new PublicKey(address);
    new PublicKey(to);
  } catch {
    res.status(400).json({ error: "Invalid Solana address" });
    return;
  }

  const wallet = await findWallet(address);
  if (!wallet) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  if (max) {
    const activeStrategies = await db
      .select({ id: executionStrategiesTable.id })
      .from(executionStrategiesTable)
      .where(
        and(
          eq(executionStrategiesTable.walletId, wallet.id),
          eq(executionStrategiesTable.enabled, true),
        ),
      )
      .limit(1);

    if (activeStrategies.length) {
      res.status(409).json({
        error: "Disable AUTO before withdrawing MAX from this wallet",
      });
      return;
    }
  }

  try {
    const keypair = Keypair.fromSecretKey(
      decryptSecret(wallet.encryptedSecret),
    );

    const result = await withdrawSol(
      keypair,
      to,
      max ? undefined : Number(amountSol),
      max,
    );

    res.json({
      status: "success",
      address,
      to,
      ...result,
    });
  } catch (error) {
    req.log.error({ err: error }, "Managed withdrawal failed");
    res.status(422).json({
      error:
        error instanceof Error
          ? error.message
          : "Withdrawal failed",
    });
  }
});

router.post("/execution/withdraw-all", async (req, res): Promise<void> => {
  const { to } = req.body ?? {};

  if (typeof to !== "string") {
    res.status(400).json({ error: "Invalid withdrawal-all request" });
    return;
  }

  try {
    new PublicKey(to);
  } catch {
    res.status(400).json({ error: "Invalid destination address" });
    return;
  }

  const wallets = await db
    .select()
    .from(executionWalletsTable)
    .where(eq(executionWalletsTable.enabled, true));

  const results: Array<Record<string, unknown>> = [];

  for (const wallet of wallets) {
    try {
      const activeStrategies = await db
        .select({ id: executionStrategiesTable.id })
        .from(executionStrategiesTable)
        .where(
          and(
            eq(executionStrategiesTable.walletId, wallet.id),
            eq(executionStrategiesTable.enabled, true),
          ),
        )
        .limit(1);

      if (activeStrategies.length) {
        results.push({
          address: wallet.address,
          ok: false,
          error: "AUTO is enabled; wallet skipped",
        });
        continue;
      }

      const keypair = Keypair.fromSecretKey(
        decryptSecret(wallet.encryptedSecret),
      );

      const result = await withdrawSol(
        keypair,
        to,
        undefined,
        true,
      );

      results.push({
        address: wallet.address,
        ok: true,
        signature: result.signature,
        amountSol: result.amountSol,
      });
    } catch (error) {
      results.push({
        address: wallet.address,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  res.json({ results });
});


router.post("/execution/wallet-state", async (req, res): Promise<void> => {
  const { address, enabled } = req.body ?? {};

  if (
    typeof address !== "string" ||
    typeof enabled !== "boolean"
  ) {
    res.status(400).json({ error: "Invalid wallet state request" });
    return;
  }

  try {
    new PublicKey(address);
  } catch {
    res.status(400).json({ error: "Invalid Solana address" });
    return;
  }

  const wallet = await findWallet(address);
  if (!wallet) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  await db
    .update(executionWalletsTable)
    .set({ enabled })
    .where(eq(executionWalletsTable.id, wallet.id));

  if (!enabled) {
    await db
      .update(executionStrategiesTable)
      .set({
        enabled: false,
        state: "idle",
        updatedAt: new Date(),
      })
      .where(eq(executionStrategiesTable.walletId, wallet.id));
  }

  res.json({
    status: "success",
    address,
    enabled,
  });
});

router.delete(
  "/execution/wallets/:address",
  async (req, res): Promise<void> => {
    const address = req.params.address;
    const { confirmAddress } = req.body ?? {};

    if (
      typeof address !== "string" ||
      typeof confirmAddress !== "string" ||
      confirmAddress !== address
    ) {
      res.status(400).json({
        error: "Wallet delete confirmation does not match",
      });
      return;
    }

    try {
      new PublicKey(address);
    } catch {
      res.status(400).json({ error: "Invalid Solana address" });
      return;
    }

    const wallet = await findWallet(address);
    if (!wallet) {
      res.status(404).json({ error: "Execution wallet not found" });
      return;
    }

    if (wallet.enabled) {
      res.status(409).json({
        error: "Disable the wallet before deleting it",
      });
      return;
    }

    const activeStrategies = await db
      .select({ id: executionStrategiesTable.id })
      .from(executionStrategiesTable)
      .where(
        and(
          eq(executionStrategiesTable.walletId, wallet.id),
          eq(executionStrategiesTable.enabled, true),
        ),
      )
      .limit(1);

    if (activeStrategies.length) {
      res.status(409).json({
        error: "Disable AUTO before deleting this wallet",
      });
      return;
    }

    const state = await walletDeletionState(address);

    if (state.positiveTokenAccounts > 0) {
      res.status(409).json({
        error:
          "Wallet still contains SPL tokens. Sell or transfer them before deleting.",
        positiveTokenAccounts: state.positiveTokenAccounts,
      });
      return;
    }

    const maxDeleteDustLamports = 10000;

    if (state.lamports > maxDeleteDustLamports) {
      res.status(409).json({
        error:
          "Wallet still contains SOL. Withdraw it before deleting.",
        balanceSol: state.lamports / 1_000_000_000,
      });
      return;
    }

    await db
      .delete(executionWalletsTable)
      .where(eq(executionWalletsTable.id, wallet.id));

    res.json({
      status: "deleted",
      address,
      abandonedDustLamports: state.lamports,
    });
  },
);

export default router;
