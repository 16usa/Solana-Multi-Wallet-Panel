from pathlib import Path

ROOT = Path.cwd()

targets = {
    "engine": ROOT / "artifacts/api-server/src/lib/execution-engine.ts",
    "solana": ROOT / "artifacts/api-server/src/routes/solana.ts",
    "execution": ROOT / "artifacts/api-server/src/routes/execution.ts",
    "strategy": ROOT / "artifacts/api-server/src/lib/strategy-worker.ts",
    "copy": ROOT / "artifacts/api-server/src/lib/copy-trading-worker.ts",
    "home": ROOT / "artifacts/solana-multi-wallet/src/pages/home.tsx",
}

for path in targets.values():
    if not path.exists():
        raise SystemExit(f"Missing expected project file: {path}")

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)

engine = targets["engine"].read_text()
engine = replace_once(engine, '''import {
  Connection,
  Keypair,''', '''import {
  Keypair,''', "engine remove Connection import")
engine = replace_once(engine, '''} from "@solana/web3.js";

function normalizedRpcUrl(): string {
  const fallback = "https://api.mainnet-beta.solana.com";
  let value = (process.env.SOLANA_RPC_URL ?? "").trim();

  if (value.startsWith("SOLANA_RPC_URL=")) {
    value = value.slice("SOLANA_RPC_URL=".length).trim();
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  if (!value) return fallback;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

const rpcUrl = normalizedRpcUrl();
export const executionConnection = new Connection(rpcUrl, "confirmed");
''', '''} from "@solana/web3.js";
import { solanaConnection } from "./solana-rpc";

export const executionConnection = solanaConnection;
''', "engine shared RPC")
engine = replace_once(engine, '''const solMint = "So11111111111111111111111111111111111111112";

type JsonRecord''', '''const solMint = "So11111111111111111111111111111111111111112";
const PRICE_CACHE_MS = 4_000;
const SOL_USD_CACHE_MS = 30_000;

const priceCache = new Map<
  string,
  { value: number; expiresAt: number }
>();
let solUsdCache:
  | { value: number; expiresAt: number }
  | null = null;

type JsonRecord''', "engine cache declarations")
engine = replace_once(engine, '''export async function currentSolUsd(): Promise<number> {
  const errors: string[] = [];
''', '''function cacheSolUsd(value: number): number {
  solUsdCache = {
    value,
    expiresAt: Date.now() + SOL_USD_CACHE_MS,
  };
  return value;
}

export async function currentSolUsd(): Promise<number> {
  if (solUsdCache && solUsdCache.expiresAt > Date.now()) {
    return solUsdCache.value;
  }

  const errors: string[] = [];
''', "engine SOL/USD cache")
if engine.count("return usdPrice;") != 3:
    raise RuntimeError("engine SOL/USD return count changed")
engine = engine.replace("return usdPrice;", "return cacheSolUsd(usdPrice);")
engine = replace_once(engine, '''export async function currentPriceSol(mint: string): Promise<number> {
  const coin = await pumpCoin(mint);
''', '''export async function currentPriceSol(mint: string): Promise<number> {
  const cached = priceCache.get(mint);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const coin = await pumpCoin(mint);
''', "engine token price cache start")
engine = replace_once(engine, '''  return marketCapSol / supply;
}

export async function executeBuy''', '''  const value = marketCapSol / supply;
  priceCache.set(mint, {
    value,
    expiresAt: Date.now() + PRICE_CACHE_MS,
  });
  return value;
}

export async function executeBuy''', "engine token price cache store")

solana = targets["solana"].read_text()
solana = replace_once(solana, '''import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";''', '''import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";''', "solana remove Connection")
solana = replace_once(solana, '''} from "@workspace/api-zod";

const router: IRouter = Router();
function normalizedRpcUrl(): string {
  const fallback = "https://api.mainnet-beta.solana.com";
  let value = (process.env.SOLANA_RPC_URL ?? "").trim();

  if (value.startsWith("SOLANA_RPC_URL=")) {
    value = value.slice("SOLANA_RPC_URL=".length).trim();
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  if (!value) return fallback;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

const rpcUrl = normalizedRpcUrl();
const connection = new Connection(rpcUrl, "confirmed");
''', '''} from "@workspace/api-zod";
import {
  rpcErrorMessage,
  solanaConnection,
} from "../lib/solana-rpc";

const router: IRouter = Router();
const connection = solanaConnection;
''', "solana shared RPC")
solana = replace_once(solana, '''.json({ error: "Could not read wallet balance from Solana RPC" });''', '''.json({ error: rpcErrorMessage(error) });''', "solana balance error")
solana = replace_once(solana, '''.json({ error: "Could not validate mint through Solana RPC" });''', '''.json({ error: rpcErrorMessage(error) });''', "solana mint error")

execution = targets["execution"].read_text()
execution = replace_once(execution, '''} from "../lib/position-accounting";

const router: IRouter = Router();
''', '''} from "../lib/position-accounting";
import { rpcErrorMessage } from "../lib/solana-rpc";

const router: IRouter = Router();
const BUY_NETWORK_RESERVE_SOL = 0.005;
''', "execution import RPC helper")
execution = replace_once(execution, '''      lastError:
        error instanceof Error
          ? error.message
          : String(error),''', '''      lastError: rpcErrorMessage(error),''', "execution restore strategy error")
execution = replace_once(execution, '''  const result = await Promise.all(
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

  res.json({ wallets: result });''', '''  const result: any[] = [];

  for (const wallet of wallets) {
    let sol: number | null = null;
    let balanceError: string | null = null;

    try {
      sol = await walletSolBalance(wallet.address);
    } catch (error) {
      balanceError = rpcErrorMessage(error);
    }

    result.push({
      id: wallet.id,
      address: wallet.address,
      enabled: wallet.enabled,
      sol,
      balanceError,
      createdAt: wallet.createdAt,
    });
  }

  res.json({ wallets: result });''', "execution wallet balances sequential")
execution = replace_once(execution, '''    priceError =
      error instanceof Error ? error.message : String(error);''', '''    priceError = rpcErrorMessage(error);''', "execution price error")
execution = replace_once(execution, '''  const rows = await Promise.all(
    wallets.map(async (wallet) => {
      let sol = 0;
      let tokenBalance = 0;

      try {
        sol = await walletSolBalance(wallet.address);
      } catch {
        sol = 0;
      }

      try {
        tokenBalance = await walletTokenBalance(
          wallet.address,
          mint,
        );
      } catch {
        tokenBalance = 0;
      }

      const strategy = strategyByWallet.get(wallet.id) ?? null;
      const financials = financialSnapshot(
        strategy,
        tokenBalance,
        priceSol,
      );

      return {
        id: wallet.id,
        address: wallet.address,
        enabled: wallet.enabled,
        sol,
        tokenBalance,
        strategy,
        pnl: financials.totalPnlPct,
        ...financials,
      };
    }),
  );''', '''  const rows: any[] = [];

  for (const wallet of wallets) {
    let sol: number | null = null;
    let tokenBalance: number | null = null;
    const balanceErrors: string[] = [];

    try {
      sol = await walletSolBalance(wallet.address);
    } catch (error) {
      balanceErrors.push(rpcErrorMessage(error));
    }

    try {
      tokenBalance = await walletTokenBalance(
        wallet.address,
        mint,
      );
    } catch (error) {
      balanceErrors.push(rpcErrorMessage(error));
    }

    const strategy = strategyByWallet.get(wallet.id) ?? null;
    const positionCostSol = strategy?.positionCostSol ?? 0;
    const totalInvestedSol =
      strategy?.totalInvestedSol ?? positionCostSol;
    const realizedPnlSol = strategy?.realizedPnlSol ?? 0;

    const financials =
      tokenBalance == null
        ? {
            positionCostSol,
            totalInvestedSol,
            realizedPnlSol,
            unrealizedPnlSol: null,
            totalPnlSol: null,
            totalPnlPct: null,
          }
        : financialSnapshot(
            strategy,
            tokenBalance,
            priceSol,
          );

    rows.push({
      id: wallet.id,
      address: wallet.address,
      enabled: wallet.enabled,
      sol,
      tokenBalance,
      balanceError:
        balanceErrors.length > 0
          ? [...new Set(balanceErrors)].join(" · ")
          : null,
      strategy,
      pnl: financials.totalPnlPct,
      ...financials,
    });
  }''', "execution state sequential")
execution = replace_once(execution, '''      (wallet) =>
        wallet.tokenBalance <= 0 ||
        wallet.unrealizedPnlSol != null,''', '''      (wallet) =>
        wallet.tokenBalance != null &&
        (wallet.tokenBalance <= 0 ||
          wallet.unrealizedPnlSol != null),''', "execution nullable token balance")
execution = replace_once(execution, '''      const beforeBalance = await walletTokenBalance(
        address,
        mint,
      );

      signature = await executeBuy(keypair, mint, amount);''', '''      const availableSol = await walletSolBalance(address);
      const requiredSol = amount + BUY_NETWORK_RESERVE_SOL;

      if (availableSol < requiredSol) {
        throw new Error(
          `Insufficient SOL. Wallet has ${availableSol.toFixed(4)} SOL; buy needs about ${requiredSol.toFixed(4)} SOL including network reserve.`,
        );
      }

      const beforeBalance = await walletTokenBalance(
        address,
        mint,
      );

      signature = await executeBuy(keypair, mint, amount);''', "execution single BUY balance check")
execution = replace_once(execution, '''      error:
        error instanceof Error
          ? error.message
          : "Trade failed",''', '''      error: rpcErrorMessage(error),''', "execution single trade friendly error")
execution = replace_once(execution, '''      if (side === "buy") {
        const beforeBalance = await walletTokenBalance(
          wallet.address,
          mint,
        );

        signature = await executeBuy(
          keypair,
          mint,
          buyAmount,
        );''', '''      if (side === "buy") {
        const availableSol = await walletSolBalance(
          wallet.address,
        );
        const requiredSol =
          buyAmount + BUY_NETWORK_RESERVE_SOL;

        if (availableSol < requiredSol) {
          throw new Error(
            `Insufficient SOL. Wallet has ${availableSol.toFixed(4)} SOL; buy needs about ${requiredSol.toFixed(4)} SOL including network reserve.`,
          );
        }

        const beforeBalance = await walletTokenBalance(
          wallet.address,
          mint,
        );

        signature = await executeBuy(
          keypair,
          mint,
          buyAmount,
        );''', "execution BUY ALL balance check")
execution = replace_once(execution, '''      results.push({
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


router.post("/execution/withdraw"''', '''      results.push({
        address: wallet.address,
        ok: false,
        error: rpcErrorMessage(error),
      });
    }
  }

  res.json({ results });
});


router.post("/execution/withdraw"''', "execution BUY ALL friendly failure")

strategy = targets["strategy"].read_text()
strategy = replace_once(strategy, '''import { recordSellAccounting } from "./position-accounting";

let running = false;''', '''import { recordSellAccounting } from "./position-accounting";
import {
  isTransientRpcError,
  rpcErrorMessage,
} from "./solana-rpc";

const STRATEGY_POLL_MS = Math.max(
  7_500,
  Number(process.env.STRATEGY_POLL_MS ?? 7_500) || 7_500,
);

let running = false;''', "strategy RPC helper")
strategy = replace_once(strategy, '''        await db
          .update(executionStrategiesTable)
          .set({
            enabled: false,
            state: "error",
            lastError:
              error instanceof Error
                ? error.message
                : String(error),
            updatedAt: new Date(),
          })''', '''        const transient = isTransientRpcError(error);

        await db
          .update(executionStrategiesTable)
          .set({
            enabled: transient ? strategy.enabled : false,
            state: transient ? "watching" : "error",
            lastError: rpcErrorMessage(error),
            updatedAt: new Date(),
          })''', "strategy transient RPC error")
strategy = replace_once(strategy, '''  }, 5000);''', '''  }, STRATEGY_POLL_MS);''', "strategy interval")

copy = targets["copy"].read_text()
copy = replace_once(copy, '''const POLL_MS = 1800;''', '''const POLL_MS = Math.max(
  5_000,
  Number(process.env.COPY_TRADING_POLL_MS ?? 5_000) || 5_000,
);''', "copy polling interval")

home = targets["home"].read_text()
home = replace_once(home, '''  sol: number;
''', '''  sol: number | null;
  balanceError?: string | null;
''', "frontend nullable SOL")
home = replace_once(home, '''  tokenBalance?: number;
''', '''  tokenBalance?: number | null;
''', "frontend nullable token balance")
home = replace_once(home, '''    }, 5000);''', '''    }, 10000);''', "frontend refresh interval")
home = replace_once(home, '''      const ok = (data.results || []).filter((x: any) => x.ok).length;
      const failed = (data.results || []).length - ok;

      setNotice(
        `${side.toUpperCase()} ALL finished · ${ok} success · ${failed} failed`,
      );''', '''      const results = data.results || [];
      const ok = results.filter((x: any) => x.ok).length;
      const failedResults = results.filter((x: any) => !x.ok);
      const failed = failedResults.length;
      const reasons = [
        ...new Set(
          failedResults
            .map((x: any) => String(x.error || '').trim())
            .filter(Boolean),
        ),
      ];
      const reasonText =
        reasons.length > 0
          ? ` · ${reasons.slice(0, 2).join(' · ')}`
          : '';

      setNotice(
        `${side.toUpperCase()} ALL finished · ${ok} success · ${failed} failed${reasonText}`,
      );''', "frontend BUY ALL failure reason")
home = replace_once(home, '''                  {wallet.strategy?.lastError && (
                    <div className="row-error">
                      {wallet.strategy.lastError}
                    </div>
                  )}''', '''                  {(wallet.balanceError ||
                    wallet.strategy?.lastError) && (
                    <div className="row-error">
                      {wallet.balanceError ||
                        wallet.strategy?.lastError}
                    </div>
                  )}''', "frontend wallet RPC error")

targets["engine"].write_text(engine)
targets["solana"].write_text(solana)
targets["execution"].write_text(execution)
targets["strategy"].write_text(strategy)
targets["copy"].write_text(copy)
targets["home"].write_text(home)

print("PATCHED")
