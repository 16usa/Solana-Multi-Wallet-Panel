import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const JUPITER_BASE = 'https://api.jup.ag/swap/v2';
const PUMP_SWAP_API = 'https://fun-block.pump.fun/agents/swap';
const PUMP_COIN_API = 'https://frontend-api-v3.pump.fun/coins-v2';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const connection = new Connection(RPC_URL, 'confirmed');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function isPublicKey(value) {
  try {
    new PublicKey(String(value || '').trim());
    return true;
  } catch {
    return false;
  }
}

function jupiterHeaders() {
  const key = process.env.JUPITER_API_KEY;
  if (!key) return null;
  return { 'x-api-key': key };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rpc: RPC_URL, jupiterConfigured: Boolean(process.env.JUPITER_API_KEY) });
});

app.get('/api/balance', async (req, res) => {
  const address = String(req.query.address || '').trim();
  if (!isPublicKey(address)) return res.status(400).json({ error: 'Invalid Solana address' });
  try {
    const lamports = await connection.getBalance(new PublicKey(address), 'confirmed');
    res.json({ address, lamports, sol: lamports / LAMPORTS_PER_SOL });
  } catch (error) {
    console.error('balance error', error);
    res.status(502).json({ error: 'Could not read wallet balance from Solana RPC' });
  }
});

app.get('/api/mint', async (req, res) => {
  const mint = String(req.query.mint || '').trim();
  if (!isPublicKey(mint)) return res.status(400).json({ error: 'Invalid mint address' });
  try {
    const info = await connection.getParsedAccountInfo(new PublicKey(mint), 'confirmed');
    if (!info.value) return res.status(404).json({ error: 'Mint account was not found' });
    const parsed = info.value?.data?.parsed;
    if (!parsed || parsed.type !== 'mint') {
      return res.status(400).json({ error: 'Address exists, but it is not an SPL token mint' });
    }
    res.json({
      mint,
      valid: true,
      decimals: parsed.info.decimals,
      supply: parsed.info.supply,
      program: info.value.owner.toBase58(),
    });
  } catch (error) {
    console.error('mint error', error);
    res.status(502).json({ error: 'Could not validate mint through Solana RPC' });
  }
});

app.post('/api/order', async (req, res) => {
  const { wallet, outputMint, amountSol } = req.body || {};
  if (!isPublicKey(wallet)) return res.status(400).json({ error: 'Invalid wallet address' });
  if (!isPublicKey(outputMint)) return res.status(400).json({ error: 'Invalid token mint' });

  const amountNumber = Number(amountSol);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0 SOL' });
  }

  const amountLamports = Math.round(amountNumber * LAMPORTS_PER_SOL);
  if (!Number.isSafeInteger(amountLamports) || amountLamports <= 0) {
    return res.status(400).json({ error: 'Amount is outside supported range' });
  }

  try {
    // Prefer Pump.fun's own transaction builder when this mint belongs to Pump.
    // It automatically handles bonding-curve vs PumpSwap state.
    let pumpCoin = null;
    try {
      const coinResponse = await fetch(`${PUMP_COIN_API}/${outputMint}`);
      if (coinResponse.ok) pumpCoin = await coinResponse.json();
    } catch (error) {
      console.warn('pump coin lookup failed, falling back to Jupiter', error.message);
    }

    if (pumpCoin?.mint === outputMint) {
      const pumpResponse = await fetch(PUMP_SWAP_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputMint: SOL_MINT,
          outputMint,
          amount: String(amountLamports),
          user: wallet,
          slippagePct: 2,
          encoding: 'base64',
        }),
      });
      const text = await pumpResponse.text();
      let payload;
      try { payload = JSON.parse(text); } catch { payload = { error: text || 'Pump.fun returned an invalid response' }; }
      if (!pumpResponse.ok || !payload.transaction) {
        return res.status(pumpResponse.status || 502).json({ error: payload.error || payload.message || 'Pump.fun could not build the transaction' });
      }
      return res.json({
        provider: 'pump',
        transaction: payload.transaction,
        router: pumpCoin.complete ? 'PumpSwap' : 'Pump Bonding Curve',
        pumpMintInfo: payload.pumpMintInfo || null,
      });
    }

    const headers = jupiterHeaders();
    if (!headers) {
      return res.status(503).json({ error: 'This mint was not detected as a Pump.fun token. Add JUPITER_API_KEY in Replit Secrets for Jupiter routing.' });
    }

    const qs = new URLSearchParams({
      inputMint: SOL_MINT,
      outputMint: String(outputMint),
      amount: String(amountLamports),
      taker: String(wallet),
    });
    const response = await fetch(`${JUPITER_BASE}/order?${qs}`, { headers });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { error: text || 'Jupiter returned an invalid response' }; }
    if (!response.ok) {
      return res.status(response.status).json({ error: payload.errorMessage || payload.error || `Jupiter /order failed (${response.status})` });
    }
    if (!payload.transaction) {
      return res.status(422).json({
        error: payload.errorMessage || 'Jupiter could quote this swap but could not build a transaction',
        router: payload.router,
        errorCode: payload.errorCode,
      });
    }
    res.json({
      provider: 'jupiter',
      requestId: payload.requestId,
      transaction: payload.transaction,
      outAmount: payload.outAmount,
      router: payload.router,
      mode: payload.mode,
      feeBps: payload.feeBps,
      feeMint: payload.feeMint,
      expireAt: payload.expireAt,
      lastValidBlockHeight: payload.lastValidBlockHeight,
    });
  } catch (error) {
    console.error('order error', error);
    res.status(502).json({ error: 'Could not prepare swap transaction' });
  }
});

app.post('/api/execute', async (req, res) => {
  const { signedTransaction, requestId, provider } = req.body || {};
  if (!signedTransaction) return res.status(400).json({ error: 'signedTransaction is required' });

  try {
    if (provider === 'pump') {
      const raw = Buffer.from(signedTransaction, 'base64');
      const signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        return res.status(422).json({ status: 'Failed', signature, error: JSON.stringify(confirmation.value.err) });
      }
      return res.json({ status: 'Success', signature, code: 0 });
    }

    const headers = jupiterHeaders();
    if (!headers) return res.status(503).json({ error: 'JUPITER_API_KEY is not configured in Replit Secrets' });
    if (!requestId) return res.status(400).json({ error: 'requestId is required for Jupiter execution' });

    const response = await fetch(`${JUPITER_BASE}/execute`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction, requestId }),
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { error: text || 'Jupiter returned an invalid response' }; }
    if (!response.ok) {
      return res.status(response.status).json({ error: payload.error || payload.errorMessage || `Jupiter /execute failed (${response.status})` });
    }
    res.json(payload);
  } catch (error) {
    console.error('execute error', error);
    res.status(502).json({ error: 'Could not submit signed transaction' });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.use((_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Multi Wallet running on port ${PORT}`);
});
