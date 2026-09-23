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
  sellPct?: string;
  balance?: number;
  balanceError?: string;
}

type Side = 'buy' | 'sell';

function getErrorMsg(err: any): string {
  if (err?.data?.error) return err.data.error;
  if (err?.error) return err.error;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function prepareSellOrder(input: {
  wallet: string;
  inputMint: string;
  percentage: number;
}) {
  const response = await fetch('/api/sell-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Sell preparation failed (${response.status})`);
  }
  return data;
}

export default function Home() {
  const { publicKey, connected, signTransaction } = useWallet();
  const connectedAddress = publicKey?.toBase58() || '';

  const [wallets, setWallets] = useState<WalletItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved)
        ? saved.map((w) => ({ ...w, sellPct: w.sellPct ?? '' }))
        : [];
    } catch {
      return [];
    }
  });

  const [newAddress, setNewAddress] = useState('');
  const [mint, setMint] = useState('');
  const [mintState, setMintState] = useState<any>({ status: 'idle' });
  const [defaultAmount, setDefaultAmount] = useState('0.10');
  const [defaultSellPct, setDefaultSellPct] = useState('100');
  const [orders, setOrders] = useState<Record<string, any>>({});
  const [busyAll, setBusyAll] = useState<Side | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  }, [wallets]);

  const activeWallets = useMemo(
    () => wallets.filter((w) => w.active),
    [wallets],
  );

  const total = useMemo(
    () =>
      activeWallets.reduce(
        (sum, w) => sum + Number(w.amount || defaultAmount || 0),
        0,
      ),
    [activeWallets, defaultAmount],
  );

  const refreshBalance = useCallback(async (address: string) => {
    try {
      const data = await getBalance({ address });
      setWallets((prev) =>
        prev.map((w) =>
          w.address === address
            ? { ...w, balance: data.sol, balanceError: '' }
            : w,
        ),
      );
    } catch (error) {
      setWallets((prev) =>
        prev.map((w) =>
          w.address === address
            ? { ...w, balanceError: getErrorMsg(error) }
            : w,
        ),
      );
    }
  }, []);

  useEffect(() => {
    wallets.forEach((wallet) => {
      if (wallet.balance == null && !wallet.balanceError) {
        refreshBalance(wallet.address);
      }
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
      const wallet: WalletItem = {
        id: crypto.randomUUID(),
        address,
        active: true,
        amount: '',
        sellPct: '',
        balance: data.sol,
      };
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
    setWallets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    );
  }

  async function handleValidateMint() {
    setMintState({ status: 'loading' });
    setOrders({});
    const value = mint.trim();

    if (!value) {
      setMintState({ status: 'idle' });
      return;
    }

    try {
      const data = await validateMint({ mint: value });
      setMintState({ status: 'valid', ...data });
    } catch (error) {
      setMintState({ status: 'error', message: getErrorMsg(error) });
    }
  }

  function validateTradeReady() {
    if (mintState.status !== 'valid' || mintState.mint !== mint.trim()) {
      setNotice('Validate the mint address first.');
      return false;
    }
    return true;
  }

  async function prepareWallet(wallet: WalletItem, side: Side) {
    setNotice('');

    if (!wallet.active) {
      setNotice(`Enable ${shortAddress(wallet.address)} first.`);
      return;
    }
    if (!validateTradeReady()) return;

    try {
      if (side === 'buy') {
        const amount = Number(wallet.amount || defaultAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('Enter a valid SOL buy amount.');
        }

        setOrders((prev) => ({
          ...prev,
          [wallet.address]: { status: 'preparing', side, amount },
        }));

        const data = await prepareOrder({
          wallet: wallet.address,
          outputMint: mint.trim(),
          amountSol: amount,
        });

        setOrders((prev) => ({
          ...prev,
          [wallet.address]: { status: 'ready', side, amount, ...data },
        }));
        return;
      }

      const percentage = Number(wallet.sellPct || defaultSellPct);
      if (
        !Number.isFinite(percentage) ||
        percentage <= 0 ||
        percentage > 100
      ) {
        throw new Error('Sell percentage must be between 0 and 100.');
      }

      setOrders((prev) => ({
        ...prev,
        [wallet.address]: { status: 'preparing', side, percentage },
      }));

      const data = await prepareSellOrder({
        wallet: wallet.address,
        inputMint: mint.trim(),
        percentage,
      });

      setOrders((prev) => ({
        ...prev,
        [wallet.address]: {
          status: 'ready',
          side,
          percentage,
          ...data,
        },
      }));
    } catch (error) {
      setOrders((prev) => ({
        ...prev,
        [wallet.address]: {
          status: 'error',
          side,
          error: getErrorMsg(error),
        },
      }));
    }
  }

  async function prepareAll(side: Side) {
    setNotice('');

    if (!activeWallets.length) {
      setNotice('Add at least one active wallet.');
      return;
    }
    if (!validateTradeReady()) return;

    setBusyAll(side);
    await Promise.all(activeWallets.map((wallet) => prepareWallet(wallet, side)));
    setBusyAll(null);
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
      setOrders((prev) => ({
        ...prev,
        [address]: { ...prev[address], status: 'signing' },
      }));

      const tx = VersionedTransaction.deserialize(
        bytesFromBase64(order.transaction),
      );
      const signed = await signTransaction(tx);
      const signedBase64 = base64FromBytes(signed.serialize());

      setOrders((prev) => ({
        ...prev,
        [address]: { ...prev[address], status: 'executing' },
      }));

      const data = await executeOrder({
        signedTransaction: signedBase64,
        requestId: order.requestId,
        provider: order.provider as any,
      });

      if (data.status !== 'Success' && data.status !== 'success') {
        throw new Error(
          data.error || `Swap failed (${data.code ?? 'unknown'})`,
        );
      }

      setOrders((prev) => ({
        ...prev,
        [address]: {
          ...prev[address],
          status: 'success',
          signature: data.signature,
          result: data,
        },
      }));
      refreshBalance(address);
    } catch (error) {
      setOrders((prev) => ({
        ...prev,
        [address]: {
          ...prev[address],
          status: 'error',
          error: getErrorMsg(error),
        },
      }));
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
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addWallet()}
              placeholder="Solana wallet address"
              spellCheck="false"
            />
            <button className="text-button" onClick={addWallet}>
              + Add wallet
            </button>
          </div>

          <div className="wallet-list">
            {wallets.length === 0 && (
              <div className="empty">No wallets added.</div>
            )}

            {wallets.map((wallet, index) => {
              const order = orders[wallet.address];
              const matches = connectedAddress === wallet.address;
              const rowBusy =
                order &&
                ['preparing', 'signing', 'executing'].includes(order.status);

              return (
                <div className="wallet-row" key={wallet.id}>
                  <div className="wallet-top">
                    <button
                      className={`toggle ${wallet.active ? 'on' : ''}`}
                      aria-label="toggle wallet"
                      onClick={() =>
                        patchWallet(wallet.id, { active: !wallet.active })
                      }
                    >
                      <span />
                    </button>

                    <span className="index">
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    <div className="wallet-main">
                      <div className="address-line">
                        <span className="address" title={wallet.address}>
                          {shortAddress(wallet.address)}
                        </span>
                        {matches && (
                          <span className="connected-dot">connected</span>
                        )}
                      </div>
                      <div className="wallet-sub">
                        {wallet.balanceError
                          ? wallet.balanceError
                          : `${formatSol(wallet.balance)} SOL`}
                      </div>
                    </div>

                    <button
                      className="icon-button"
                      onClick={() => refreshBalance(wallet.address)}
                      aria-label="refresh balance"
                    >
                      ↻
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => removeWallet(wallet.id)}
                      aria-label="remove wallet"
                    >
                      ×
                    </button>
                  </div>

                  <div className="wallet-controls">
                    <div className="wallet-control">
                      <span className="control-label">BUY</span>
                      <input
                        className="wallet-amount"
                        inputMode="decimal"
                        value={wallet.amount}
                        onChange={(e) =>
                          patchWallet(wallet.id, {
                            amount: e.target.value.replace(/[^0-9.]/g, ''),
                          })
                        }
                        placeholder={defaultAmount || '0.10'}
                        aria-label="wallet buy amount"
                      />
                      <span className="control-unit">SOL</span>
                      <button
                        className="trade-button buy"
                        disabled={!wallet.active || rowBusy}
                        onClick={() => prepareWallet(wallet, 'buy')}
                      >
                        BUY
                      </button>
                    </div>

                    <div className="wallet-control">
                      <span className="control-label">SELL</span>
                      <input
                        className="wallet-percent"
                        inputMode="decimal"
                        value={wallet.sellPct || ''}
                        onChange={(e) =>
                          patchWallet(wallet.id, {
                            sellPct: e.target.value.replace(/[^0-9.]/g, ''),
                          })
                        }
                        placeholder={defaultSellPct || '100'}
                        aria-label="wallet sell percent"
                      />
                      <span className="control-unit">%</span>
                      <button
                        className="trade-button sell"
                        disabled={!wallet.active || rowBusy}
                        onClick={() => prepareWallet(wallet, 'sell')}
                      >
                        SELL
                      </button>
                    </div>
                  </div>

                  {order && (
                    <div className={`order-line ${order.status}`}>
                      <span>
                        {order.status === 'ready'
                          ? `Ready ${String(order.side || '').toUpperCase()} · ${order.router || 'route'}`
                          : order.status === 'success'
                            ? `${String(order.side || '').toUpperCase()} confirmed`
                            : order.status === 'error'
                              ? order.error
                              : order.status}
                      </span>

                      {order.status === 'ready' && (
                        <button
                          onClick={() => signAndExecute(wallet.address)}
                          disabled={!matches}
                        >
                          Sign & execute
                        </button>
                      )}

                      {order.status === 'success' && order.signature && (
                        <a
                          href={`https://solscan.io/tx/${order.signature}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Solscan
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section token-section">
          <div className="section-head">
            <span>Token</span>
          </div>
          <div className="field-row">
            <input
              value={mint}
              onChange={(e) => {
                setMint(e.target.value);
                setMintState({ status: 'idle' });
                setOrders({});
              }}
              placeholder="Paste token mint"
              spellCheck="false"
            />
            <button className="text-button" onClick={handleValidateMint}>
              Validate
            </button>
          </div>
          <div className={`validation ${mintState.status}`}>
            {mintState.status === 'loading' && 'Checking mint…'}
            {mintState.status === 'valid' &&
              `Valid SPL mint · ${mintState.decimals} decimals`}
            {mintState.status === 'error' && mintState.message}
          </div>
        </section>

        <section className="section trade-section">
          <div className="section-head">
            <span>All wallets</span>
          </div>

          <div className="global-settings">
            <div className="global-setting">
              <span>Buy / wallet</span>
              <div className="global-input">
                <input
                  inputMode="decimal"
                  value={defaultAmount}
                  onChange={(e) =>
                    setDefaultAmount(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                />
                <b>SOL</b>
              </div>
            </div>

            <div className="global-setting">
              <span>Sell / wallet</span>
              <div className="global-input">
                <input
                  inputMode="decimal"
                  value={defaultSellPct}
                  onChange={(e) =>
                    setDefaultSellPct(e.target.value.replace(/[^0-9.]/g, ''))
                  }
                />
                <b>%</b>
              </div>
            </div>
          </div>

          <div className="summary">
            <span>
              {activeWallets.length} wallet
              {activeWallets.length === 1 ? '' : 's'}
            </span>
            <strong>
              {Number.isFinite(total) ? total.toFixed(4) : '0.0000'} SOL buy total
            </strong>
          </div>

          <div className="all-actions">
            <button
              className="primary buy-all"
              onClick={() => prepareAll('buy')}
              disabled={busyAll !== null || !activeWallets.length}
            >
              {busyAll === 'buy' ? 'PREPARING…' : 'BUY ALL'}
            </button>

            <button
              className="primary sell-all"
              onClick={() => prepareAll('sell')}
              disabled={busyAll !== null || !activeWallets.length}
            >
              {busyAll === 'sell' ? 'PREPARING…' : 'SELL ALL'}
            </button>
          </div>
        </section>

        {notice && <div className="notice">{notice}</div>}

        <p className="footnote">
          Private keys and seed phrases are never stored by this app. Prepared
          transactions are signed only by the matching connected wallet.
        </p>
      </section>
    </main>
  );
}
