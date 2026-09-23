from pathlib import Path

targets = [
    Path("artifacts/api-server/src/routes/solana.ts"),
    Path("artifacts/api-server/src/lib/execution-engine.ts"),
]

old = '''const rpcUrl =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const connection = new Connection(rpcUrl, "confirmed");'''

old_exec = '''const rpcUrl =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
export const executionConnection = new Connection(rpcUrl, "confirmed");'''

helper = '''function normalizedRpcUrl(): string {
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

const rpcUrl = normalizedRpcUrl();'''

for p in targets:
    text = p.read_text()

    if "function normalizedRpcUrl()" in text:
        print(f"{p}: RPC normalization already present")
        continue

    if p.name == "solana.ts":
        if old not in text:
            raise SystemExit(f"Could not find RPC block in {p}")
        text = text.replace(
            old,
            helper + '\nconst connection = new Connection(rpcUrl, "confirmed");',
            1,
        )
    else:
        if old_exec not in text:
            raise SystemExit(f"Could not find RPC block in {p}")
        text = text.replace(
            old_exec,
            helper + '\nexport const executionConnection = new Connection(rpcUrl, "confirmed");',
            1,
        )

    p.write_text(text)
    print(f"{p}: patched")
