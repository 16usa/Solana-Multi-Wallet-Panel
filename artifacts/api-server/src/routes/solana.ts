import { Router, type IRouter } from "express";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  ExecuteOrderBody,
  ExecuteOrderResponse,
  GetBalanceQueryParams,
  GetBalanceResponse,
  PrepareOrderBody,
  PrepareOrderResponse,
  ValidateMintQueryParams,
  ValidateMintResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const rpcUrl =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const connection = new Connection(rpcUrl, "confirmed");
const jupiterBase = "https://api.jup.ag/swap/v2";
const pumpSwapApi = "https://fun-block.pump.fun/agents/swap";
const pumpCoinApi = "https://frontend-api-v3.pump.fun/coins-v2";
const solMint = "So11111111111111111111111111111111111111112";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isPublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function jupiterHeaders(): Record<string, string> | null {
  const key = process.env.JUPITER_API_KEY;
  return key ? { "x-api-key": key } : null;
}

async function readJson(response: globalThis.Response): Promise<JsonRecord> {
  const text = await response.text();
  if (!text) return {};
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return { error: text };
  }
}

async function lookupPumpCoin(mint: string, req: any): Promise<JsonRecord> {
  try {
    const coinResponse = await fetch(`${pumpCoinApi}/${mint}`);
    if (coinResponse.ok) return await readJson(coinResponse);
  } catch (error) {
    req.log.warn({ err: error }, "Pump.fun mint lookup failed; trying Jupiter");
  }
  return {};
}

async function rawTokenBalance(wallet: string, mint: string): Promise<bigint> {
  const result = await connection.getParsedTokenAccountsByOwner(
    new PublicKey(wallet),
    { mint: new PublicKey(mint) },
    "confirmed",
  );

  let total = 0n;

  for (const item of result.value) {
    const data = asRecord(item.account.data);
    const parsed = asRecord(data.parsed);
    const info = asRecord(parsed.info);
    const tokenAmount = asRecord(info.tokenAmount);
    const amount = stringValue(tokenAmount.amount);

    if (amount && /^\d+$/.test(amount)) {
      total += BigInt(amount);
    }
  }

  return total;
}

router.get("/balance", async (req, res): Promise<void> => {
  const parsed = GetBalanceQueryParams.safeParse(req.query);
  if (!parsed.success || !isPublicKey(parsed.data.address)) {
    res.status(400).json({ error: "Invalid Solana address" });
    return;
  }

  try {
    const lamports = await connection.getBalance(
      new PublicKey(parsed.data.address),
      "confirmed",
    );
    res.json(
      GetBalanceResponse.parse({
        address: parsed.data.address,
        lamports,
        sol: lamports / LAMPORTS_PER_SOL,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Solana balance lookup failed");
    res
      .status(502)
      .json({ error: "Could not read wallet balance from Solana RPC" });
  }
});

router.get("/mint", async (req, res): Promise<void> => {
  const parsed = ValidateMintQueryParams.safeParse(req.query);
  if (!parsed.success || !isPublicKey(parsed.data.mint)) {
    res.status(400).json({ error: "Invalid mint address" });
    return;
  }

  try {
    const info = await connection.getParsedAccountInfo(
      new PublicKey(parsed.data.mint),
      "confirmed",
    );
    if (!info.value) {
      res.status(404).json({ error: "Mint account was not found" });
      return;
    }

    const data = asRecord(info.value.data);
    const parsedData = asRecord(data.parsed);
    const parsedInfo = asRecord(parsedData.info);
    if (parsedData.type !== "mint") {
      res
        .status(400)
        .json({ error: "Address exists, but it is not an SPL token mint" });
      return;
    }

    res.json(
      ValidateMintResponse.parse({
        mint: parsed.data.mint,
        valid: true,
        decimals: parsedInfo.decimals,
        supply: parsedInfo.supply,
        program: info.value.owner.toBase58(),
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Solana mint validation failed");
    res
      .status(502)
      .json({ error: "Could not validate mint through Solana RPC" });
  }
});

router.post("/order", async (req, res): Promise<void> => {
  const parsed = PrepareOrderBody.safeParse(req.body);
  if (
    !parsed.success ||
    !isPublicKey(parsed.data.wallet) ||
    !isPublicKey(parsed.data.outputMint)
  ) {
    res.status(400).json({ error: "Invalid order request" });
    return;
  }

  const amountLamports = Math.round(
    parsed.data.amountSol * LAMPORTS_PER_SOL,
  );
  if (!Number.isSafeInteger(amountLamports) || amountLamports <= 0) {
    res.status(400).json({ error: "Amount is outside supported range" });
    return;
  }

  try {
    const pumpCoin = await lookupPumpCoin(parsed.data.outputMint, req);

    if (pumpCoin.mint === parsed.data.outputMint) {
      const pumpResponse = await fetch(pumpSwapApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputMint: solMint,
          outputMint: parsed.data.outputMint,
          amount: String(amountLamports),
          user: parsed.data.wallet,
          slippagePct: 2,
          encoding: "base64",
        }),
      });
      const payload = await readJson(pumpResponse);
      const transaction = stringValue(payload.transaction);
      if (!pumpResponse.ok || !transaction) {
        res.status(pumpResponse.status || 502).json({
          error:
            stringValue(payload.error) ??
            stringValue(payload.message) ??
            "Pump.fun could not build the transaction",
        });
        return;
      }

      res.json(
        PrepareOrderResponse.parse({
          provider: "pump",
          transaction,
          router: pumpCoin.complete
            ? "PumpSwap"
            : "Pump Bonding Curve",
        }),
      );
      return;
    }

    const headers = jupiterHeaders();
    if (!headers) {
      res.status(503).json({
        error:
          "This mint was not detected as a Pump.fun token. Add JUPITER_API_KEY in Replit Secrets for Jupiter routing.",
      });
      return;
    }

    const params = new URLSearchParams({
      inputMint: solMint,
      outputMint: parsed.data.outputMint,
      amount: String(amountLamports),
      taker: parsed.data.wallet,
    });
    const response = await fetch(`${jupiterBase}/order?${params}`, {
      headers,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      res.status(response.status).json({
        error:
          stringValue(payload.errorMessage) ??
          stringValue(payload.error) ??
          `Jupiter /order failed (${response.status})`,
      });
      return;
    }

    const transaction = stringValue(payload.transaction);
    if (!transaction) {
      res.status(422).json({
        error:
          stringValue(payload.errorMessage) ??
          "Jupiter could quote this swap but could not build a transaction",
        router: payload.router ?? null,
        errorCode: payload.errorCode ?? null,
      });
      return;
    }

    res.json(
      PrepareOrderResponse.parse({
        provider: "jupiter",
        requestId: payload.requestId ?? null,
        transaction,
        outAmount: payload.outAmount ?? null,
        router: payload.router ?? null,
        mode: payload.mode ?? null,
        feeBps: payload.feeBps ?? null,
        feeMint: payload.feeMint ?? null,
        expireAt: payload.expireAt ?? null,
        lastValidBlockHeight: payload.lastValidBlockHeight ?? null,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Swap order preparation failed");
    res.status(502).json({ error: "Could not prepare swap transaction" });
  }
});

router.post("/sell-order", async (req, res): Promise<void> => {
  const body = asRecord(req.body);
  const wallet = stringValue(body.wallet);
  const inputMint = stringValue(body.inputMint);
  const percentage =
    typeof body.percentage === "number" ? body.percentage : Number.NaN;

  if (
    !wallet ||
    !inputMint ||
    !isPublicKey(wallet) ||
    !isPublicKey(inputMint) ||
    !Number.isFinite(percentage) ||
    percentage <= 0 ||
    percentage > 100
  ) {
    res.status(400).json({ error: "Invalid sell order request" });
    return;
  }

  try {
    const rawBalance = await rawTokenBalance(wallet, inputMint);

    if (rawBalance <= 0n) {
      res.status(400).json({ error: "This wallet has no balance of this token" });
      return;
    }

    const percentageBps = BigInt(Math.round(percentage * 100));
    const amountRaw = (rawBalance * percentageBps) / 10000n;

    if (amountRaw <= 0n) {
      res.status(400).json({ error: "Sell amount is too small" });
      return;
    }

    const pumpCoin = await lookupPumpCoin(inputMint, req);

    if (pumpCoin.mint === inputMint) {
      const pumpResponse = await fetch(pumpSwapApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputMint,
          outputMint: solMint,
          amount: amountRaw.toString(),
          user: wallet,
          slippagePct: 2,
          encoding: "base64",
        }),
      });

      const payload = await readJson(pumpResponse);
      const transaction = stringValue(payload.transaction);

      if (!pumpResponse.ok || !transaction) {
        res.status(pumpResponse.status || 502).json({
          error:
            stringValue(payload.error) ??
            stringValue(payload.message) ??
            "Pump.fun could not build the sell transaction",
        });
        return;
      }

      res.json(
        PrepareOrderResponse.parse({
          provider: "pump",
          transaction,
          router: pumpCoin.complete
            ? "PumpSwap"
            : "Pump Bonding Curve",
        }),
      );
      return;
    }

    const headers = jupiterHeaders();
    if (!headers) {
      res.status(503).json({
        error:
          "This mint was not detected as a Pump.fun token. Add JUPITER_API_KEY in Replit Secrets for Jupiter routing.",
      });
      return;
    }

    const params = new URLSearchParams({
      inputMint,
      outputMint: solMint,
      amount: amountRaw.toString(),
      taker: wallet,
    });

    const response = await fetch(`${jupiterBase}/order?${params}`, {
      headers,
    });
    const payload = await readJson(response);

    if (!response.ok) {
      res.status(response.status).json({
        error:
          stringValue(payload.errorMessage) ??
          stringValue(payload.error) ??
          `Jupiter sell /order failed (${response.status})`,
      });
      return;
    }

    const transaction = stringValue(payload.transaction);

    if (!transaction) {
      res.status(422).json({
        error:
          stringValue(payload.errorMessage) ??
          "Jupiter could quote this sell but could not build a transaction",
        router: payload.router ?? null,
        errorCode: payload.errorCode ?? null,
      });
      return;
    }

    res.json(
      PrepareOrderResponse.parse({
        provider: "jupiter",
        requestId: payload.requestId ?? null,
        transaction,
        outAmount: payload.outAmount ?? null,
        router: payload.router ?? null,
        mode: payload.mode ?? null,
        feeBps: payload.feeBps ?? null,
        feeMint: payload.feeMint ?? null,
        expireAt: payload.expireAt ?? null,
        lastValidBlockHeight: payload.lastValidBlockHeight ?? null,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Sell order preparation failed");
    res.status(502).json({ error: "Could not prepare sell transaction" });
  }
});

router.post("/execute", async (req, res): Promise<void> => {
  const parsed = ExecuteOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid execution request" });
    return;
  }

  try {
    if (parsed.data.provider === "pump") {
      const signature = await connection.sendRawTransaction(
        Buffer.from(parsed.data.signedTransaction, "base64"),
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        },
      );
      const confirmation = await connection.confirmTransaction(
        signature,
        "confirmed",
      );
      if (confirmation.value.err) {
        res.status(422).json({
          status: "Failed",
          signature,
          error: JSON.stringify(confirmation.value.err),
        });
        return;
      }

      res.json(
        ExecuteOrderResponse.parse({
          status: "Success",
          signature,
          code: 0,
        }),
      );
      return;
    }

    const headers = jupiterHeaders();
    if (!headers) {
      res
        .status(503)
        .json({ error: "JUPITER_API_KEY is not configured in Replit Secrets" });
      return;
    }
    if (!parsed.data.requestId) {
      res
        .status(400)
        .json({ error: "requestId is required for Jupiter execution" });
      return;
    }

    const response = await fetch(`${jupiterBase}/execute`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        signedTransaction: parsed.data.signedTransaction,
        requestId: parsed.data.requestId,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      res.status(response.status).json({
        error:
          stringValue(payload.error) ??
          stringValue(payload.errorMessage) ??
          `Jupiter /execute failed (${response.status})`,
      });
      return;
    }

    res.json(ExecuteOrderResponse.parse(payload));
  } catch (error) {
    req.log.error({ err: error }, "Signed transaction submission failed");
    res.status(502).json({ error: "Could not submit signed transaction" });
  }
});

export default router;
