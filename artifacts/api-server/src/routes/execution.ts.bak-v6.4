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

async function setEntryPrice(walletId: string, mint: string) {
  const price = await currentPriceSol(mint);

  await db
    .insert(executionStrategiesTable)
    .values({
      walletId,
      mint,
      enabled: false,
      entryPriceSol: price,
      tpFired: false,
      state: "idle",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        executionStrategiesTable.walletId,
        executionStrategiesTable.mint,
      ],
      set: {
        entryPriceSol: price,
        tpFired: false,
        state: "idle",
        lastTrigger: null,
        lastSignature: null,
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

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

  try {
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

      signature = await executeBuy(keypair, mint, amount);
      await setEntryPrice(wallet.id, mint);
    } else {
      const percentage = Number(sellPct);
      signature = await executeSellPercent(
        keypair,
        mint,
        percentage,
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

  const wallets = await db
    .select()
    .from(executionWalletsTable)
    .where(eq(executionWalletsTable.enabled, true));

  const results: Array<Record<string, unknown>> = [];

  for (const wallet of wallets) {
    try {
      const keypair = Keypair.fromSecretKey(
        decryptSecret(wallet.encryptedSecret),
      );

      const signature =
        side === "buy"
          ? await executeBuy(
              keypair,
              mint,
              Number(amountSol),
            )
          : await executeSellPercent(
              keypair,
              mint,
              Number(sellPct),
            );

      if (side === "buy") {
        await setEntryPrice(wallet.id, mint);
      }

      results.push({
        address: wallet.address,
        ok: true,
        signature,
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

export default router;
