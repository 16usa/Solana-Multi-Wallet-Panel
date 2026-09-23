import { Connection } from "@solana/web3.js";

const PUBLIC_RPC_URL = "https://api.mainnet-beta.solana.com";

function normalizedRpcUrl(): string {
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

  if (!value) return PUBLIC_RPC_URL;

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return PUBLIC_RPC_URL;
    }
    return parsed.toString();
  } catch {
    return PUBLIC_RPC_URL;
  }
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed)
    : fallback;
}

const rpcUrl = normalizedRpcUrl();
const usingPublicRpc =
  new URL(rpcUrl).hostname === "api.mainnet-beta.solana.com";

const minimumIntervalMs = positiveInteger(
  process.env.SOLANA_RPC_MIN_INTERVAL_MS,
  usingPublicRpc ? 300 : 75,
);

const maxRetries = positiveInteger(
  process.env.SOLANA_RPC_MAX_RETRIES,
  3,
);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

function retryDelayMs(
  response: globalThis.Response,
  attempt: number,
): number {
  const retryAfter = Number(response.headers.get("retry-after"));

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(500, retryAfter * 1000);
  }

  return Math.min(4_000, 500 * 2 ** attempt);
}

function retryableStatus(status: number): boolean {
  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

const rpcFetch: typeof fetch = async (input, init) => {
  const task = async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    nextRequestAt = Date.now() + minimumIntervalMs;

    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(input, init);

      if (
        !retryableStatus(response.status) ||
        attempt >= maxRetries
      ) {
        return response;
      }

      await sleep(retryDelayMs(response, attempt));
    }
  };

  const result = requestQueue.then(task, task);

  requestQueue = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
};

export const solanaConnection = new Connection(rpcUrl, {
  commitment: "confirmed",
  fetch: rpcFetch as any,
});

function rawErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

export function isTransientRpcError(error: unknown): boolean {
  const message = rawErrorMessage(error);

  return /429|too many requests|rate limit|connection rate limits exceeded|fetch failed|econnreset|etimedout|timeout|socket hang up|502|503|504/i.test(
    message,
  );
}

export function rpcErrorMessage(error: unknown): string {
  const message = rawErrorMessage(error).trim();

  if (
    /429|too many requests|rate limit|connection rate limits exceeded/i.test(
      message,
    )
  ) {
    return "Solana RPC rate limit reached. The app retried automatically. Add a dedicated SOLANA_RPC_URL in Replit Secrets for stable 24/7 execution.";
  }

  if (
    /fetch failed|econnreset|etimedout|timeout|socket hang up/i.test(
      message,
    )
  ) {
    return "Temporary Solana RPC/network error. Retry in a moment.";
  }

  if (!message) {
    return "Solana RPC request failed.";
  }

  return message.length > 240
    ? `${message.slice(0, 240)}…`
    : message;
}
