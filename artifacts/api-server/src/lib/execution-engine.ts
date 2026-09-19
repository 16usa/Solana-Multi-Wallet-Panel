import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

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

const jupiterBase = "https://api.jup.ag/swap/v2";
const jupiterPriceBase = "https://api.jup.ag/price/v3";
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

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
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

function jupiterHeaders(): Record<string, string> | null {
  const key = process.env.JUPITER_API_KEY;
  return key ? { "x-api-key": key } : null;
}

export async function currentSolUsd(): Promise<number> {
  const errors: string[] = [];

  const headers = jupiterHeaders();

  if (headers) {
    try {
      const response = await fetch(
        `${jupiterPriceBase}?ids=${encodeURIComponent(solMint)}`,
        { headers },
      );

      const payload = await readJson(response);

      if (response.ok) {
        const sol = asRecord(payload[solMint]);
        const usdPrice = numberValue(sol.usdPrice);

        if (usdPrice != null && usdPrice > 0) {
          return usdPrice;
        }
      }

      errors.push(
        stringValue(payload.error) ??
          `Jupiter ${response.status}`,
      );
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `Jupiter: ${error.message}`
          : "Jupiter failed",
      );
    }
  }

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      {
        headers: {
          accept: "application/json",
          "user-agent": "Solana-Multi-Wallet-Panel/1.0",
        },
      },
    );

    const payload = await readJson(response);
    const solana = asRecord(payload.solana);
    const usdPrice = numberValue(solana.usd);

    if (response.ok && usdPrice != null && usdPrice > 0) {
      return usdPrice;
    }

    errors.push(`CoinGecko ${response.status}`);
  } catch (error) {
    errors.push(
      error instanceof Error
        ? `CoinGecko: ${error.message}`
        : "CoinGecko failed",
    );
  }

  try {
    const response = await fetch(
      "https://api.coinbase.com/v2/prices/SOL-USD/spot",
      {
        headers: {
          accept: "application/json",
          "user-agent": "Solana-Multi-Wallet-Panel/1.0",
        },
      },
    );

    const payload = await readJson(response);
    const data = asRecord(payload.data);
    const usdPrice = numberValue(data.amount);

    if (response.ok && usdPrice != null && usdPrice > 0) {
      return usdPrice;
    }

    errors.push(`Coinbase ${response.status}`);
  } catch (error) {
    errors.push(
      error instanceof Error
        ? `Coinbase: ${error.message}`
        : "Coinbase failed",
    );
  }

  throw new Error(
    `SOL/USD price is unavailable${errors.length ? ` · ${errors.join(" · ")}` : ""}`,
  );
}

async function pumpCoin(mint: string): Promise<JsonRecord> {
  const response = await fetch(`${pumpCoinApi}/${mint}`);
  if (!response.ok) return {};
  return readJson(response);
}

async function signAndSubmitPump(
  transaction: string,
  keypair: Keypair,
): Promise<string> {
  const tx = VersionedTransaction.deserialize(
    Buffer.from(transaction, "base64"),
  );
  tx.sign([keypair]);

  const signature = await executionConnection.sendRawTransaction(
    tx.serialize(),
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    },
  );

  const confirmation = await executionConnection.confirmTransaction(
    signature,
    "confirmed",
  );

  if (confirmation.value.err) {
    throw new Error(JSON.stringify(confirmation.value.err));
  }

  return signature;
}

async function signAndSubmitJupiter(
  transaction: string,
  requestId: string,
  keypair: Keypair,
): Promise<string> {
  const headers = jupiterHeaders();
  if (!headers) {
    throw new Error("JUPITER_API_KEY is not configured");
  }

  const tx = VersionedTransaction.deserialize(
    Buffer.from(transaction, "base64"),
  );
  tx.sign([keypair]);

  const signedTransaction = Buffer.from(tx.serialize()).toString("base64");

  const response = await fetch(`${jupiterBase}/execute`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      signedTransaction,
      requestId,
    }),
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(
      stringValue(payload.error) ??
        stringValue(payload.errorMessage) ??
        `Jupiter execute failed (${response.status})`,
    );
  }

  const signature =
    stringValue(payload.signature) ??
    stringValue(payload.txid) ??
    stringValue(payload.transactionSignature);

  if (!signature) {
    throw new Error("Jupiter executed the swap but returned no signature");
  }

  return signature;
}

async function buildSwap(
  user: string,
  inputMint: string,
  outputMint: string,
  amountRaw: bigint,
): Promise<{
  provider: "pump" | "jupiter";
  transaction: string;
  requestId?: string;
}> {
  const coinMint = inputMint === solMint ? outputMint : inputMint;
  const coin = await pumpCoin(coinMint);

  if (coin.mint === coinMint) {
    const response = await fetch(pumpSwapApi, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputMint,
        outputMint,
        amount: amountRaw.toString(),
        user,
        slippagePct: 2,
        encoding: "base64",
      }),
    });

    const payload = await readJson(response);
    const transaction = stringValue(payload.transaction);

    if (!response.ok || !transaction) {
      throw new Error(
        stringValue(payload.error) ??
          stringValue(payload.message) ??
          "Pump.fun could not build the transaction",
      );
    }

    return {
      provider: "pump",
      transaction,
    };
  }

  const headers = jupiterHeaders();
  if (!headers) {
    throw new Error(
      "Non-Pump token requires JUPITER_API_KEY",
    );
  }

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw.toString(),
    taker: user,
  });

  const response = await fetch(`${jupiterBase}/order?${params}`, {
    headers,
  });

  const payload = await readJson(response);
  const transaction = stringValue(payload.transaction);
  const requestId = stringValue(payload.requestId);

  if (!response.ok || !transaction || !requestId) {
    throw new Error(
      stringValue(payload.errorMessage) ??
        stringValue(payload.error) ??
        "Jupiter could not build the transaction",
    );
  }

  return {
    provider: "jupiter",
    transaction,
    requestId,
  };
}

async function rawTokenBalance(
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const result =
    await executionConnection.getParsedTokenAccountsByOwner(
      owner,
      { mint },
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

export async function walletSolBalance(address: string): Promise<number> {
  const lamports = await executionConnection.getBalance(
    new PublicKey(address),
    "confirmed",
  );
  return lamports / LAMPORTS_PER_SOL;
}

export async function transactionSolDelta(
  address: string,
  signature: string,
): Promise<number> {
  const owner = new PublicKey(address);

  const transaction = await executionConnection.getTransaction(
    signature,
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  );

  if (!transaction?.meta) {
    throw new Error("Confirmed transaction details are unavailable");
  }

  const accountKeys = transaction.transaction.message.getAccountKeys({
    accountKeysFromLookups:
      transaction.meta.loadedAddresses ?? undefined,
  });

  let ownerIndex = -1;

  for (let index = 0; index < accountKeys.length; index += 1) {
    const key = accountKeys.get(index);
    if (key?.equals(owner)) {
      ownerIndex = index;
      break;
    }
  }

  if (ownerIndex < 0) {
    throw new Error("Wallet was not found in the confirmed transaction");
  }

  const before = transaction.meta.preBalances[ownerIndex];
  const after = transaction.meta.postBalances[ownerIndex];

  if (before == null || after == null) {
    throw new Error("Transaction SOL balance delta is unavailable");
  }

  return (after - before) / LAMPORTS_PER_SOL;
}

export async function walletTokenBalance(
  address: string,
  mint: string,
): Promise<number> {
  const result =
    await executionConnection.getParsedTokenAccountsByOwner(
      new PublicKey(address),
      { mint: new PublicKey(mint) },
      "confirmed",
    );

  let total = 0;

  for (const item of result.value) {
    const data = asRecord(item.account.data);
    const parsed = asRecord(data.parsed);
    const info = asRecord(parsed.info);
    const tokenAmount = asRecord(info.tokenAmount);

    const uiAmountString = stringValue(
      tokenAmount.uiAmountString,
    );

    if (uiAmountString != null) {
      const value = Number(uiAmountString);
      if (Number.isFinite(value)) {
        total += value;
        continue;
      }
    }

    const rawAmount = stringValue(tokenAmount.amount);
    const decimals = numberValue(tokenAmount.decimals);

    if (
      rawAmount &&
      /^\d+$/.test(rawAmount) &&
      decimals != null
    ) {
      const value =
        Number(rawAmount) / 10 ** decimals;

      if (Number.isFinite(value)) {
        total += value;
      }
    }
  }

  return total;
}

export async function currentPriceSol(mint: string): Promise<number> {
  const coin = await pumpCoin(mint);
  if (coin.mint !== mint) {
    throw new Error(
      "24/7 TP/SL monitoring currently supports Pump.fun mints",
    );
  }

  const info = await executionConnection.getParsedAccountInfo(
    new PublicKey(mint),
    "confirmed",
  );

  if (!info.value) {
    throw new Error("Mint account was not found");
  }

  const data = asRecord(info.value.data);
  const parsed = asRecord(data.parsed);
  const mintInfo = asRecord(parsed.info);

  const rawSupply = stringValue(mintInfo.supply);
  const decimals = numberValue(mintInfo.decimals);
  const marketCapSol = numberValue(coin.market_cap);

  if (
    !rawSupply ||
    decimals == null ||
    marketCapSol == null ||
    marketCapSol <= 0
  ) {
    throw new Error("Pump.fun price data is unavailable");
  }

  const supply = Number(rawSupply) / 10 ** decimals;
  if (!Number.isFinite(supply) || supply <= 0) {
    throw new Error("Invalid token supply");
  }

  return marketCapSol / supply;
}

export async function executeBuy(
  keypair: Keypair,
  mint: string,
  amountSol: number,
): Promise<string> {
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  if (!Number.isSafeInteger(lamports) || lamports <= 0) {
    throw new Error("Invalid SOL amount");
  }

  const order = await buildSwap(
    keypair.publicKey.toBase58(),
    solMint,
    mint,
    BigInt(lamports),
  );

  if (order.provider === "pump") {
    return signAndSubmitPump(order.transaction, keypair);
  }

  return signAndSubmitJupiter(
    order.transaction,
    order.requestId!,
    keypair,
  );
}

export async function executeSellPercent(
  keypair: Keypair,
  mint: string,
  percentage: number,
): Promise<string> {
  if (
    !Number.isFinite(percentage) ||
    percentage <= 0 ||
    percentage > 100
  ) {
    throw new Error("Sell percentage must be between 0 and 100");
  }

  const tokenBalance = await rawTokenBalance(
    keypair.publicKey,
    new PublicKey(mint),
  );

  if (tokenBalance <= 0n) {
    throw new Error("Wallet has no balance of this token");
  }

  const bps = BigInt(Math.round(percentage * 100));
  const amountRaw = (tokenBalance * bps) / 10000n;

  if (amountRaw <= 0n) {
    throw new Error("Sell amount is too small");
  }

  const order = await buildSwap(
    keypair.publicKey.toBase58(),
    mint,
    solMint,
    amountRaw,
  );

  if (order.provider === "pump") {
    return signAndSubmitPump(order.transaction, keypair);
  }

  return signAndSubmitJupiter(
    order.transaction,
    order.requestId!,
    keypair,
  );
}


export async function withdrawSol(
  keypair: Keypair,
  destination: string,
  amountSol?: number,
  max = false,
): Promise<{ signature: string; amountSol: number }> {
  const to = new PublicKey(destination);

  if (to.equals(keypair.publicKey)) {
    throw new Error("Destination cannot be the same wallet");
  }

  const balance = await executionConnection.getBalance(
    keypair.publicKey,
    "confirmed",
  );

  const latest = await executionConnection.getLatestBlockhash("confirmed");

  const probe = new Transaction({
    feePayer: keypair.publicKey,
    recentBlockhash: latest.blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: to,
      lamports: 1,
    }),
  );

  const feeResult = await executionConnection.getFeeForMessage(
    probe.compileMessage(),
    "confirmed",
  );

  const networkFee = feeResult.value ?? 5000;
  const reserve = networkFee + 5000;

  let lamports: number;

  if (max) {
    lamports = balance - reserve;
  } else {
    const requested = Number(amountSol);
    lamports = Math.round(requested * LAMPORTS_PER_SOL);

    if (!Number.isFinite(requested) || !Number.isSafeInteger(lamports) || lamports <= 0) {
      throw new Error("Invalid SOL withdrawal amount");
    }
  }

  if (lamports <= 0) {
    throw new Error("Wallet balance is too low to withdraw after network fee reserve");
  }

  if (lamports + networkFee > balance) {
    throw new Error("Insufficient SOL balance for withdrawal and network fee");
  }

  const tx = new Transaction({
    feePayer: keypair.publicKey,
    recentBlockhash: latest.blockhash,
  }).add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: to,
      lamports,
    }),
  );

  tx.sign(keypair);

  const signature = await executionConnection.sendRawTransaction(
    tx.serialize(),
    {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    },
  );

  const confirmation = await executionConnection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );

  if (confirmation.value.err) {
    throw new Error(JSON.stringify(confirmation.value.err));
  }

  return {
    signature,
    amountSol: lamports / LAMPORTS_PER_SOL,
  };
}


const SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export async function walletDeletionState(address: string): Promise<{
  lamports: number;
  positiveTokenAccounts: number;
}> {
  const owner = new PublicKey(address);

  const lamports = await executionConnection.getBalance(
    owner,
    "confirmed",
  );

  let positiveTokenAccounts = 0;

  for (const programId of [
    SPL_TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
  ]) {
    const accounts =
      await executionConnection.getParsedTokenAccountsByOwner(
        owner,
        { programId },
        "confirmed",
      );

    for (const item of accounts.value) {
      const data = asRecord(item.account.data);
      const parsed = asRecord(data.parsed);
      const info = asRecord(parsed.info);
      const tokenAmount = asRecord(info.tokenAmount);
      const amount = stringValue(tokenAmount.amount);

      if (amount && /^\d+$/.test(amount) && BigInt(amount) > 0n) {
        positiveTokenAccounts += 1;
      }
    }
  }

  return {
    lamports,
    positiveTokenAccounts,
  };
}
