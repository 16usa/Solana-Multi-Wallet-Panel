import { eq } from "drizzle-orm";
import {
  db,
  executionStrategiesTable,
  type ExecutionStrategy,
} from "@workspace/db";
import {
  currentPriceSol,
  transactionSolDelta,
  walletTokenBalance,
} from "./execution-engine";

const BALANCE_EPSILON = 1e-12;

function storedPositionCost(
  strategy: ExecutionStrategy | null | undefined,
  tokenBalance: number,
): number {
  if (!strategy) return 0;

  if (
    Number.isFinite(strategy.positionCostSol) &&
    strategy.positionCostSol > 0
  ) {
    return strategy.positionCostSol;
  }

  if (
    tokenBalance > 0 &&
    strategy.entryPriceSol &&
    strategy.entryPriceSol > 0
  ) {
    return tokenBalance * strategy.entryPriceSol;
  }

  return 0;
}

function storedTotalInvested(
  strategy: ExecutionStrategy | null | undefined,
  fallbackCost: number,
): number {
  if (
    strategy &&
    Number.isFinite(strategy.totalInvestedSol) &&
    strategy.totalInvestedSol > 0
  ) {
    return strategy.totalInvestedSol;
  }

  return fallbackCost;
}

async function waitForTokenBalance(
  address: string,
  mint: string,
  beforeBalance: number,
  direction: "up" | "down",
): Promise<number> {
  let latest = beforeBalance;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    latest = await walletTokenBalance(address, mint);

    if (
      (direction === "up" && latest > beforeBalance) ||
      (direction === "down" && latest < beforeBalance)
    ) {
      return latest;
    }

    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  return latest;
}

export function financialSnapshot(
  strategy: ExecutionStrategy | null | undefined,
  tokenBalance: number,
  priceSol: number | null,
) {
  const positionCostSol = storedPositionCost(
    strategy,
    tokenBalance,
  );

  const totalInvestedSol = storedTotalInvested(
    strategy,
    positionCostSol,
  );

  const realizedPnlSol =
    strategy?.realizedPnlSol &&
    Number.isFinite(strategy.realizedPnlSol)
      ? strategy.realizedPnlSol
      : 0;

  let unrealizedPnlSol: number | null;

  if (tokenBalance <= BALANCE_EPSILON) {
    unrealizedPnlSol = 0;
  } else if (priceSol != null && positionCostSol > 0) {
    unrealizedPnlSol =
      tokenBalance * priceSol - positionCostSol;
  } else {
    unrealizedPnlSol = null;
  }

  const totalPnlSol =
    unrealizedPnlSol == null
      ? null
      : realizedPnlSol + unrealizedPnlSol;

  const totalPnlPct =
    totalPnlSol != null && totalInvestedSol > 0
      ? (totalPnlSol / totalInvestedSol) * 100
      : null;

  return {
    positionCostSol,
    totalInvestedSol,
    realizedPnlSol,
    unrealizedPnlSol,
    totalPnlSol,
    totalPnlPct,
  };
}

export async function recordBuyAccounting({
  walletId,
  address,
  mint,
  amountSol,
  beforeBalance,
  previousStrategy,
}: {
  walletId: string;
  address: string;
  mint: string;
  amountSol: number;
  beforeBalance: number;
  previousStrategy: ExecutionStrategy | null;
}) {
  let afterBalance = await waitForTokenBalance(
    address,
    mint,
    beforeBalance,
    "up",
  );

  const newCycle = beforeBalance <= BALANCE_EPSILON;

  const previousCost = newCycle
    ? 0
    : storedPositionCost(
        previousStrategy,
        beforeBalance,
      );

  const previousInvested = newCycle
    ? 0
    : storedTotalInvested(
        previousStrategy,
        previousCost,
      );

  const realizedPnlSol = newCycle
    ? 0
    : previousStrategy?.realizedPnlSol ?? 0;

  const positionCostSol = previousCost + amountSol;
  const totalInvestedSol =
    previousInvested + amountSol;

  if (afterBalance <= beforeBalance) {
    const current = await currentPriceSol(mint);
    const estimatedAcquired = amountSol / current;
    afterBalance = beforeBalance + estimatedAcquired;
  }

  const entryPriceSol =
    positionCostSol / afterBalance;

  if (
    !Number.isFinite(entryPriceSol) ||
    entryPriceSol <= 0
  ) {
    throw new Error(
      "Could not calculate the weighted entry price",
    );
  }

  const enabled = previousStrategy?.enabled ?? false;

  await db
    .insert(executionStrategiesTable)
    .values({
      walletId,
      mint,
      enabled,
      entryPriceSol,
      positionCostSol,
      totalInvestedSol,
      realizedPnlSol,
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
        positionCostSol,
        totalInvestedSol,
        realizedPnlSol,
        tpFired: false,
        state: enabled ? "watching" : "idle",
        lastTrigger: null,
        lastSignature: null,
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

export async function recordSellAccounting({
  strategy,
  address,
  mint,
  beforeBalance,
  percentage,
  signature,
  trigger,
  forceDisable,
  tpFired,
}: {
  strategy: ExecutionStrategy | null;
  address: string;
  mint: string;
  beforeBalance: number;
  percentage: number;
  signature: string;
  trigger: string;
  forceDisable: boolean;
  tpFired?: boolean;
}) {
  if (!strategy) return;

  const afterBalance = await waitForTokenBalance(
    address,
    mint,
    beforeBalance,
    "down",
  );

  let soldFraction =
    beforeBalance > BALANCE_EPSILON
      ? (beforeBalance - afterBalance) / beforeBalance
      : percentage / 100;

  if (
    !Number.isFinite(soldFraction) ||
    soldFraction <= 0
  ) {
    soldFraction = percentage / 100;
  }

  soldFraction = Math.min(
    1,
    Math.max(0, soldFraction),
  );

  const previousCost = storedPositionCost(
    strategy,
    beforeBalance,
  );

  const totalInvestedSol = storedTotalInvested(
    strategy,
    previousCost,
  );

  const costSold = previousCost * soldFraction;
  const proceedsSol = await transactionSolDelta(
    address,
    signature,
  );

  const realizedPnlSol =
    (strategy.realizedPnlSol ?? 0) +
    proceedsSol -
    costSold;

  const fullExit =
    percentage >= 100 ||
    afterBalance <= BALANCE_EPSILON;

  const positionCostSol = fullExit
    ? 0
    : Math.max(0, previousCost - costSold);

  const entryPriceSol =
    fullExit || afterBalance <= BALANCE_EPSILON
      ? null
      : positionCostSol / afterBalance;

  const enabled =
    fullExit || forceDisable
      ? false
      : strategy.enabled;

  await db
    .update(executionStrategiesTable)
    .set({
      enabled,
      entryPriceSol,
      positionCostSol,
      totalInvestedSol,
      realizedPnlSol,
      tpFired: fullExit
        ? false
        : tpFired ?? strategy.tpFired,
      state: fullExit
        ? "closed"
        : enabled
          ? "watching"
          : "idle",
      lastTrigger: trigger,
      lastSignature: signature,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(executionStrategiesTable.id, strategy.id));
}
