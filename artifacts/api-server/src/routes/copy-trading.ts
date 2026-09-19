import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  copyTradeControlTable,
  copyTradeEventsTable,
  copyTradeExecutionsTable,
  copyTradeSourcesTable,
  copyTradeTargetsTable,
  executionWalletsTable,
} from "@workspace/db";

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

async function ensureControl() {
  const rows = await db
    .insert(copyTradeControlTable)
    .values({ id: "global", enabled: false })
    .onConflictDoNothing()
    .returning();

  if (rows[0]) return rows[0];

  const existing = await db
    .select()
    .from(copyTradeControlTable)
    .where(eq(copyTradeControlTable.id, "global"))
    .limit(1);

  return existing[0];
}

async function fullState() {
  const control = await ensureControl();

  const sources = await db
    .select()
    .from(copyTradeSourcesTable);

  const targets = await db
    .select()
    .from(copyTradeTargetsTable);

  const wallets = await db
    .select()
    .from(executionWalletsTable);

  const walletById = new Map(
    wallets.map((wallet) => [wallet.id, wallet]),
  );

  const events = await db
    .select()
    .from(copyTradeEventsTable)
    .orderBy(desc(copyTradeEventsTable.createdAt))
    .limit(25);

  const eventIds = new Set(events.map((event) => event.id));
  const allExecutions = await db
    .select()
    .from(copyTradeExecutionsTable)
    .orderBy(desc(copyTradeExecutionsTable.createdAt))
    .limit(150);

  const executions = allExecutions.filter((item) =>
    eventIds.has(item.eventId),
  );

  return {
    enabled: control?.enabled ?? false,
    sources: sources.map((source) => ({
      ...source,
      targets: targets
        .filter((target) => target.sourceId === source.id)
        .map((target) => ({
          ...target,
          address: walletById.get(target.walletId)?.address ?? "",
          walletEnabled:
            walletById.get(target.walletId)?.enabled ?? false,
        })),
    })),
    history: events.map((event) => ({
      ...event,
      executions: executions.filter(
        (item) => item.eventId === event.id,
      ),
    })),
  };
}

router.get("/copy-trading", async (_req, res): Promise<void> => {
  res.json(await fullState());
});

router.post("/copy-trading/control", async (req, res): Promise<void> => {
  const { enabled } = req.body ?? {};

  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be boolean" });
    return;
  }

  const current = await ensureControl();

  await db
    .insert(copyTradeControlTable)
    .values({
      id: "global",
      enabled,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: copyTradeControlTable.id,
      set: {
        enabled,
        updatedAt: new Date(),
      },
    });

  if (enabled && !current?.enabled) {
    await db
      .update(copyTradeSourcesTable)
      .set({
        lastSignature: null,
        updatedAt: new Date(),
      });
  }

  res.json(await fullState());
});

router.post("/copy-trading/source", async (req, res): Promise<void> => {
  const address =
    typeof req.body?.address === "string"
      ? req.body.address.trim()
      : "";

  try {
    new PublicKey(address);
  } catch {
    res.status(400).json({ error: "Invalid Solana source wallet" });
    return;
  }

  const executionWallet = await db
    .select()
    .from(executionWalletsTable)
    .where(eq(executionWalletsTable.address, address))
    .limit(1);

  if (executionWallet[0]) {
    res.status(409).json({
      error: "An execution wallet cannot also be a copy source",
    });
    return;
  }

  const inserted = await db
    .insert(copyTradeSourcesTable)
    .values({
      address,
      enabled: true,
      copyBuys: true,
      copySells: true,
      mode: "follow-source",
      maxBuyAmount: 0.1,
      maxBuyCurrency: "sol",
      slippagePct: 2,
      delayMs: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted[0]) {
    res.status(409).json({ error: "Source wallet already exists" });
    return;
  }

  const wallets = await db
    .select()
    .from(executionWalletsTable);

  for (const wallet of wallets) {
    await db
      .insert(copyTradeTargetsTable)
      .values({
        sourceId: inserted[0].id,
        walletId: wallet.id,
        enabled: wallet.enabled,
        buyAmount: 0.01,
        buyCurrency: "sol",
      })
      .onConflictDoNothing();
  }

  res.status(201).json(await fullState());
});

router.post("/copy-trading/source/:id", async (req, res): Promise<void> => {
  const sourceRows = await db
    .select()
    .from(copyTradeSourcesTable)
    .where(eq(copyTradeSourcesTable.id, req.params.id))
    .limit(1);

  const source = sourceRows[0];

  if (!source) {
    res.status(404).json({ error: "Copy source not found" });
    return;
  }

  const {
    enabled,
    copyBuys,
    copySells,
    mode,
    maxBuyAmount,
    maxBuyCurrency,
    slippagePct,
    delayMs,
    autoTpPct,
    autoTpSellPct,
    autoSlPct,
    autoSlSellPct,
    targets,
  } = req.body ?? {};

  if (
    typeof enabled !== "boolean" ||
    typeof copyBuys !== "boolean" ||
    typeof copySells !== "boolean" ||
    !["follow-source", "copy-buy-auto"].includes(mode) ||
    !["sol", "usd"].includes(maxBuyCurrency)
  ) {
    res.status(400).json({ error: "Invalid copy source settings" });
    return;
  }

  const numbers = {
    maxBuyAmount: Number(maxBuyAmount),
    slippagePct: Number(slippagePct),
    delayMs: Number(delayMs),
    autoTpPct: Number(autoTpPct),
    autoTpSellPct: Number(autoTpSellPct),
    autoSlPct: Number(autoSlPct),
    autoSlSellPct: Number(autoSlSellPct),
  };

  if (
    !Number.isFinite(numbers.maxBuyAmount) ||
    numbers.maxBuyAmount <= 0 ||
    !Number.isFinite(numbers.slippagePct) ||
    numbers.slippagePct <= 0 ||
    numbers.slippagePct > 50 ||
    !Number.isFinite(numbers.delayMs) ||
    numbers.delayMs < 0 ||
    numbers.delayMs > 15000 ||
    !Number.isFinite(numbers.autoTpPct) ||
    numbers.autoTpPct <= 0 ||
    !Number.isFinite(numbers.autoTpSellPct) ||
    numbers.autoTpSellPct <= 0 ||
    numbers.autoTpSellPct > 100 ||
    !Number.isFinite(numbers.autoSlPct) ||
    numbers.autoSlPct <= 0 ||
    !Number.isFinite(numbers.autoSlSellPct) ||
    numbers.autoSlSellPct <= 0 ||
    numbers.autoSlSellPct > 100
  ) {
    res.status(400).json({ error: "Invalid numeric copy settings" });
    return;
  }

  await db
    .update(copyTradeSourcesTable)
    .set({
      enabled,
      copyBuys,
      copySells,
      mode,
      maxBuyAmount: numbers.maxBuyAmount,
      maxBuyCurrency,
      slippagePct: numbers.slippagePct,
      delayMs: numbers.delayMs,
      autoTpPct: numbers.autoTpPct,
      autoTpSellPct: numbers.autoTpSellPct,
      autoSlPct: numbers.autoSlPct,
      autoSlSellPct: numbers.autoSlSellPct,
      lastSignature:
        enabled && !source.enabled
          ? null
          : source.lastSignature,
      updatedAt: new Date(),
    })
    .where(eq(copyTradeSourcesTable.id, source.id));

  if (Array.isArray(targets)) {
    for (const item of targets) {
      if (
        typeof item?.walletId !== "string" ||
        typeof item?.enabled !== "boolean" ||
        !["sol", "usd"].includes(item?.buyCurrency)
      ) {
        continue;
      }

      const amount = Number(item.buyAmount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      await db
        .insert(copyTradeTargetsTable)
        .values({
          sourceId: source.id,
          walletId: item.walletId,
          enabled: item.enabled,
          buyAmount: amount,
          buyCurrency: item.buyCurrency,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            copyTradeTargetsTable.sourceId,
            copyTradeTargetsTable.walletId,
          ],
          set: {
            enabled: item.enabled,
            buyAmount: amount,
            buyCurrency: item.buyCurrency,
            updatedAt: new Date(),
          },
        });
    }
  }

  res.json(await fullState());
});

router.delete("/copy-trading/source/:id", async (req, res): Promise<void> => {
  const deleted = await db
    .delete(copyTradeSourcesTable)
    .where(eq(copyTradeSourcesTable.id, req.params.id))
    .returning({ id: copyTradeSourcesTable.id });

  if (!deleted[0]) {
    res.status(404).json({ error: "Copy source not found" });
    return;
  }

  res.json(await fullState());
});

export default router;
