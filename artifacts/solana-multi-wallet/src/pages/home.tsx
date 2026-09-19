import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { VersionedTransaction } from '@solana/web3.js';
import { getBalance, validateMint, prepareOrder, executeOrder } from '@workspace/api-client-react';

const STORAGE_KEY = 'multi-wallet:wallets:v1';

function shortAddress(value: string) {
  return value ? `${value.slice(0, 5)}…${value.slice(-5)}` : '';
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64FromBytes(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function formatSol(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  if (value >= 100) return value.toFixed(2);
  if (value >= 1) return value.toFixed(3);
  return value.toFixed(4);
}

interface WalletItem {
  id: string;
  address: string;
  active: boolean;
  amount: string;
  balance?: number;
  balanceError?: string;
}

function getErrorMsg(err: any): string {
  if (err?.data?.error) return err.data.error;
  if (err?.error) return err.error;
  if (err instanceof Error) return err.message;
  return String(err);
}

export default function Home() {
  const { publicKey, connected, signTransaction } = useWallet();
  const connectedAddress = publicKey?.toBase58() || '';
  const [wallets, setWallets] = useState<WalletItem[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });
  const [newAddress, setNewAddress] = useState('');
  const [mint, setMint] = useState('');
  const [mintState, setMintState] = useState<any>({ status: 'idle' });
  const [defaultAmount, setDefaultAmount] = useState('0.10');
  const [orders, setOrders] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  }, [wallets]);

  const activeWallets = useMemo(() => wallets.filter((w) => w.active), [wallets]);
  const total = useMemo(() => activeWallets.reduce((sum, w) => sum + Number(w.amount || defaultAmount || 0), 0), [activeWallets, defaultAmount]);

  const refreshBalance = useCallback(async (address: string) => {
    try {
      const data = await getBalance({ address });
      setWallets((prev) => prev.map((w) => w.address === address ? { ...w, balance: data.sol, balanceError: '' } : w));
    } catch (error) {
      setWallets((prev) => prev.map((w) => w.address === address ? { ...w, balanceError: getErrorMsg(error) } : w));
    }
  }, []);

  useEffect(() => {
    wallets.forEach((wallet) => {
      if (wallet.balance == null && !wallet.balanceError) refreshBalance(wallet.address);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function addWallet() {
    setNotice('');
    const address = newAddress.trim();
    if (!address) return;
    if (wallets.some((w) => w.address === address)) {
      setNotice('This wallet is already in the list.');
      return;
    }
    try {
      const data = await getBalance({ address });
      const wallet: WalletItem = { id: crypto.randomUUID(), address, active: true, amount: '', balance: data.sol };
      setWallets((prev) => [...prev, wallet]);
      setNewAddress('');
    } catch (error) {
      setNotice(getErrorMsg(error) || 'Invalid wallet address.');
    }
  }

  function removeWallet(id: string) {
    const target = wallets.find((w) => w.id === id);
    if (target) {
      setOrders((prev) => {
        const copy = { ...prev };
        delete copy[target.address];
        return copy;
      });
    }
    setWallets((prev) => prev.filter((w) => w.id !== id));
  }

  function patchWallet(id: string, patch: Partial<WalletItem>) {
    setWallets((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w));
  }

  async function handleValidateMint() {
    setMintState({ status: 'loading' });
    setOrders({});
    const value = mint.trim();
    if (!value) return setMintState({ status: 'idle' });
    try {
      const data = await validateMint({ mint: value });
      setMintState({ status: 'valid', ...data });
    } catch (error) {
      setMintState({ status: 'error', message: getErrorMsg(error) });
    }
  }

  async function prepareBuys() {
    setNotice('');
    if (!activeWallets.length) return setNotice('Add at least one active wallet.');
    if (mintState.status !== 'valid' || mintState.mint !== mint.trim()) {
      return setNotice('Validate the mint address first.');
    }
    setBusy(true);
    setOrders({});
    const next: Record<string, any> = {};
    await Promise.all(activeWallets.map(async (wallet) => {
      const amount = Number(wallet.amount || defaultAmount);
      next[wallet.address] = { status: 'preparing', amount };
      setOrders((prev) => ({ ...prev, [wallet.address]: next[wallet.address] }));
      try {
        const data = await prepareOrder({ wallet: wallet.address, outputMint: mint.trim(), amountSol: amount });
        next[wallet.address] = { status: 'ready', amount, ...data };
      } catch (error) {
        next[wallet.address] = { status: 'error', amount, error: getErrorMsg(error) };
      }
      setOrders((prev) => ({ ...prev, [wallet.address]: next[wallet.address] }));
    }));
    setBusy(false);
  }

  async function signAndExecute(address: string) {
    const order = orders[address];
    if (!connected || connectedAddress !== address) {
      setNotice(`Connect ${shortAddress(address)} before signing this transaction.`);
      return;
    }
    if (!signTransaction) {
      setNotice('The connected wallet does not expose transaction signing.');
      return;
    }
    try {
      setOrders((prev) => ({ ...prev, [address]: { ...prev[address], status: 'signing' } }));
      const tx = VersionedTransaction.deserialize(bytesFromBase64(order.transaction));
      const signed = await signTransaction(tx);
      const signedBase64 = base64FromBytes(signed.serialize());
      setOrders((prev) => ({ ...prev, [address]: { ...prev[address], status: 'executing' } }));
      
      const data = await executeOrder({ 
        signedTransaction: signedBase64, 
        requestId: order.requestId, 
        provider: order.provider as any 
      });
      
      if (data.status !== 'Success' && data.status !== 'success') {
        throw new Error(data.error || `Swap failed (${data.code ?? 'unknown'})`);
      }
      
      setOrders((prev) => ({ ...prev, [address]: { ...prev[address], status: 'success', signature: data.signature, result: data } }));
      refreshBalance(address);
    } catch (error) {
      setOrders((prev) => ({ ...prev, [address]: { ...prev[address], status: 'error', error: getErrorMsg(error) } }));
    }
  }

  return (
    <main className="page">
      <section className="shell">
        <header className="topbar">
          <h1>MULTI WALLET</h1>
          <WalletMultiButton className="wallet-connect" />
        </header>

        <section className="section">
          <div className="section-head">
            <span>Wallets</span>
            <span className="muted">{activeWallets.length} active</span>
          </div>

          <div className="add-row">
            <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWallet()} placeholder="Solana wallet address" spellCheck="false" />
            <button className="text-button" onClick={addWallet}>+ Add wallet</button>
          </div>

          <div className="wallet-list">
            {wallets.length === 0 && <div className="empty">No wallets added.</div>}
            {wallets.map((wallet, index) => {
              const order = orders[wallet.address];
              const matches = connectedAddress === wallet.address;
              return (
                <div className="wallet-row" key={wallet.id}>
                  <button className={`toggle ${wallet.active ? 'on' : ''}`} aria-label="toggle wallet" onClick={() => patchWallet(wallet.id, { active: !wallet.active })}><span /></button>
                  <span className="index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="wallet-main">
                    <div className="address-line">
                      <span className="address" title={wallet.address}>{shortAddress(wallet.address)}</span>
                      {matches && <span className="connected-dot">connected</span>}
                    </div>
                    <div className="wallet-sub">{wallet.balanceError ? wallet.balanceError : `${formatSol(wallet.balance)} SOL`}</div>
                  </div>
                  <input className="wallet-amount" inputMode="decimal" value={wallet.amount} onChange={(e) => patchWallet(wallet.id, { amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder={defaultAmount || '0.10'} aria-label="wallet amount" />
                  <span className="unit">SOL</span>
                  <button className="icon-button" onClick={() => refreshBalance(wallet.address)} aria-label="refresh balance">↻</button>
                  <button className="icon-button" onClick={() => removeWallet(wallet.id)} aria-label="remove wallet">×</button>
                  {order && (
                    <div className={`order-line ${order.status}`}>
                      <span>{order.status === 'ready' ? `Ready · ${order.router || 'route'}` : order.status === 'success' ? 'Confirmed' : order.status === 'error' ? order.error : order.status}</span>
                      {order.status === 'ready' && <button onClick={() => signAndExecute(wallet.address)} disabled={!matches}>Sign & execute</button>}
                      {order.status === 'success' && order.signature && <a href={`https://solscan.io/tx/${order.signature}`} target="_blank" rel="noreferrer">Solscan</a>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><span>Token</span></div>
          <label>Mint address</label>
          <div className="field-row">
            <input value={mint} onChange={(e) => { setMint(e.target.value); setMintState({ status: 'idle' }); setOrders({}); }} placeholder="Paste token mint" spellCheck="false" />
            <button className="text-button" onClick={handleValidateMint}>Validate</button>
          </div>
          <div className={`validation ${mintState.status}`}>
            {mintState.status === 'loading' && 'Checking mint…'}
            {mintState.status === 'valid' && `Valid SPL mint · ${mintState.decimals} decimals`}
            {mintState.status === 'error' && mintState.message}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><span>Amount per wallet</span></div>
          <div className="amount-main">
            <input inputMode="decimal" value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
            <span>SOL</span>
          </div>
          <div className="summary">
            <span>{activeWallets.length} wallet{activeWallets.length === 1 ? '' : 's'}</span>
            <strong>{Number.isFinite(total) ? total.toFixed(4) : '0.0000'} SOL total</strong>
          </div>
        </section>

        {notice && <div className="notice">{notice}</div>}

        <button className="primary" onClick={prepareBuys} disabled={busy || !activeWallets.length}>
          {busy ? 'PREPARING…' : 'PREPARE BUY'}
        </button>

        <p className="footnote">Private keys and seed phrases are never stored by this app. Each prepared transaction must be signed by its matching wallet.</p>
      </section>
    </main>
  );
}
