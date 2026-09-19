import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

const rpcUrl =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
export const executionConnection = new Connection(rpcUrl, "confirmed");

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
