import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { validateMint } from '@workspace/api-client-react';

const WITHDRAWAL_STORAGE_KEY = 'multi-wallet:withdrawal-address:v1';

type Strategy = {
  enabled: boolean;
  tpPct: number;
  tpSellPct: number;
  slPct: number;
  slSellPct: number;
  entryPriceSol?: number | null;
  state?: string;
  lastTrigger?: string | null;
  lastSignature?: string | null;
  lastError?: string | null;
};

type WalletRow = {
  id: string;
  address: string;
  enabled: boolean;
  sol: number;
  strategy?: Strategy | null;
  pnl?: number | null;
};

const short = (value: string) =>
  `${value.slice(0, 5)}…${value.slice(-5)}`;

const numberText = (value: number | null | undefined, digits = 4) =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

export default function Home() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('panel-token') || '',
  );
  const [tokenInput, setTokenInput] = useState(token);
  const [unlocked, setUnlocked] = useState(Boolean(token));

  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [mint, setMint] = useState('');
  const [mintState, setMintState] = useState<any>({ status: 'idle' });
  const [priceSol, setPriceSol] = useState<number | null>(null);
  const [priceError, setPriceError] = useState('');

  const [buyAmount, setBuyAmount] = useState('0.01');
  const [sellPct, setSellPct] = useState('100');

  const [tpPct, setTpPct] = useState('100');
  const [tpSellPct, setTpSellPct] = useState('50');
  const [slPct, setSlPct] = useState('30');
  const [slSellPct, setSlSellPct] = useState('100');

  const [drafts, setDrafts] = useState<Record<string, {
    tpPct: string;
    tpSellPct: string;
    slPct: string;
    slSellPct: string;
  }>>({});

  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const [menuWallet, setMenuWallet] = useState<WalletRow | null>(null);
  const [fundsOpen, setFundsOpen] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState(
    () => localStorage.getItem(WITHDRAWAL_STORAGE_KEY) || '',
  );
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawMax, setWithdrawMax] = useState(false);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    return data;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!unlocked || !token) return;

    try {
      if (mintState.status === 'valid' && mint.trim()) {
        const data = await api(
          `/api/execution/state?mint=${encodeURIComponent(mint.trim())}`,
        );

        setWallets(data.wallets || []);
        setPriceSol(data.priceSol ?? null);
        setPriceError(data.priceError || '');

        setDrafts((prev) => {
          const next = { ...prev };
          for (const wallet of data.wallets || []) {
            if (!next[wallet.address]) {
              const s = wallet.strategy;
              next[wallet.address] = {
                tpPct: String(s?.tpPct ?? tpPct),
                tpSellPct: String(s?.tpSellPct ?? tpSellPct),
                slPct: String(s?.slPct ?? slPct),
                slSellPct: String(s?.slSellPct ?? slSellPct),
              };
            }
          }
          return next;
        });
      } else {
        const data = await api('/api/execution/wallets');
        setWallets(data.wallets || []);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [
    unlocked,
    token,
    mint,
    mintState.status,
    api,
    tpPct,
    tpSellPct,
    slPct,
    slSellPct,
  ]);

  useEffect(() => {
    if (!unlocked) return;
    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [unlocked, refresh]);

  const activeCount = useMemo(
    () => wallets.filter((w) => w.enabled).length,
    [wallets],
  );

  function unlock() {
    const value = tokenInput.trim();
    if (!value) return;

    sessionStorage.setItem('panel-token', value);
    setToken(value);
    setUnlocked(true);
    setNotice('');
  }

  function lock() {
    sessionStorage.removeItem('panel-token');
    setToken('');
    setTokenInput('');
    setUnlocked(false);
    setWallets([]);
  }

  async function createWallet() {
    setBusy('create');
    setNotice('');

    try {
      await api('/api/execution/wallets', {
        method: 'POST',
        body: '{}',
      });
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setNotice(`Address copied · ${short(address)}`);
      return;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = address;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (copied) {
        setNotice(`Address copied · ${short(address)}`);
      } else {
        setNotice(`Could not copy automatically. Full address: ${address}`);
      }
    }
  }

  async function refreshWallet(address: string) {
    setBusy(`${address}:refresh`);
    setNotice('');

    try {
      if (mintState.status === 'valid' && mint.trim()) {
        const data = await api(
          `/api/execution/state?mint=${encodeURIComponent(mint.trim())}`,
        );
        const next = (data.wallets || []).find(
          (wallet: WalletRow) => wallet.address === address,
        );

        if (next) {
          setWallets((prev) =>
            prev.map((wallet) =>
              wallet.address === address ? next : wallet,
            ),
          );
        }

        setPriceSol(data.priceSol ?? null);
        setPriceError(data.priceError || '');
      } else {
        const data = await api('/api/execution/wallets');
        const next = (data.wallets || []).find(
          (wallet: WalletRow) => wallet.address === address,
        );

        if (next) {
          setWallets((prev) =>
            prev.map((wallet) =>
              wallet.address === address ? next : wallet,
            ),
          );
        }
      }

      setNotice(`Balance refreshed · ${short(address)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }


  function openWalletFunds(wallet: WalletRow) {
    setMenuWallet(wallet);
    setFundsOpen(false);
    setWithdrawAddress(
      localStorage.getItem(WITHDRAWAL_STORAGE_KEY) || withdrawAddress,
    );
    setWithdrawAmount('');
    setWithdrawMax(false);
    setNotice('');
  }

  function openGlobalFunds() {
    setMenuWallet(null);
    setFundsOpen(true);
    setWithdrawAddress(
      localStorage.getItem(WITHDRAWAL_STORAGE_KEY) || withdrawAddress,
    );
    setWithdrawAmount('');
    setWithdrawMax(false);
    setNotice('');
  }

  function closeFunds() {
    setMenuWallet(null);
    setFundsOpen(false);
    setWithdrawAmount('');
    setWithdrawMax(false);
  }

  function saveWithdrawalAddress() {
    const value = withdrawAddress.trim();
    if (!value) {
      setNotice('Enter a withdrawal address first.');
      return;
    }

    localStorage.setItem(WITHDRAWAL_STORAGE_KEY, value);
    setNotice('Default withdrawal address saved on this device.');
  }

  async function withdrawFromWallet(wallet: WalletRow) {
    const to = withdrawAddress.trim();
    const amount = Number(withdrawAmount);

    if (!to) {
      setNotice('Enter a withdrawal address.');
      return;
    }

    if (!withdrawMax && (!Number.isFinite(amount) || amount <= 0)) {
      setNotice('Enter a valid SOL amount or choose MAX.');
      return;
    }

    const label = withdrawMax ? 'MAX' : `${amount} SOL`;
    const confirmed = window.confirm(
      `Withdraw ${label} from ${short(wallet.address)} to ${short(to)}?`,
    );

    if (!confirmed) return;

    setBusy(`${wallet.address}:withdraw`);
    setNotice('');

    try {
      const data = await api('/api/execution/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          address: wallet.address,
          to,
          amountSol: withdrawMax ? undefined : amount,
          max: withdrawMax,
        }),
      });

      setNotice(
        `Withdrawal confirmed · ${data.amountSol.toFixed(6)} SOL · ${data.signature}`,
      );
      closeFunds();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function withdrawAllWallets() {
    const to = withdrawAddress.trim();

    if (!to) {
      setNotice('Enter a withdrawal address.');
      return;
    }

    const confirmed = window.confirm(
      `Withdraw available SOL from all enabled execution wallets to ${short(to)}?`,
    );

    if (!confirmed) return;

    setBusy('withdraw-all');
    setNotice('');

    try {
      const data = await api('/api/execution/withdraw-all', {
        method: 'POST',
        body: JSON.stringify({ to }),
      });

      const ok = (data.results || []).filter((item: any) => item.ok).length;
      const failed = (data.results || []).length - ok;

      setNotice(`Withdraw all finished · ${ok} success · ${failed} failed`);
      closeFunds();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }


  async function setWalletEnabled(wallet: WalletRow, enabled: boolean) {
    if (!enabled) {
      const confirmed = window.confirm(
        `Disable ${short(wallet.address)}? Trading and AUTO will stop for this wallet.`,
      );
      if (!confirmed) return;
    }

    setBusy(`${wallet.address}:state`);
    setNotice('');

    try {
      await api('/api/execution/wallet-state', {
        method: 'POST',
        body: JSON.stringify({
          address: wallet.address,
          enabled,
        }),
      });

      setNotice(
        `${short(wallet.address)} · ${enabled ? 'enabled' : 'disabled'}`,
      );
      closeFunds();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function deleteWallet(wallet: WalletRow) {
    if (wallet.enabled) {
      setNotice('Disable the wallet before deleting it.');
      return;
    }

    const typed = window.prompt(
      `Permanent delete ${short(wallet.address)}. Type DELETE to confirm.`,
    );

    if (typed !== 'DELETE') return;

    setBusy(`${wallet.address}:delete`);
    setNotice('');

    try {
      await api(
        `/api/execution/wallets/${encodeURIComponent(wallet.address)}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            confirmAddress: wallet.address,
          }),
        },
      );

      setNotice(`Wallet deleted · ${short(wallet.address)}`);
      closeFunds();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function validate() {
    const value = mint.trim();
    if (!value) return;

    setMintState({ status: 'loading' });
    setNotice('');

    try {
      const data = await validateMint({ mint: value });
      setMintState({ status: 'valid', ...data });
    } catch (error) {
      setMintState({
        status: 'error',
        message:
          error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function trade(
    address: string,
    side: 'buy' | 'sell',
  ) {
    if (mintState.status !== 'valid') {
      setNotice('Validate the mint first.');
      return;
    }

    setBusy(`${address}:${side}`);
    setNotice('');

    try {
      const data = await api('/api/execution/trade', {
        method: 'POST',
        body: JSON.stringify({
          address,
          mint: mint.trim(),
          side,
          amountSol: Number(buyAmount),
          sellPct: Number(sellPct),
        }),
      });

      setNotice(
        `${side.toUpperCase()} confirmed · ${short(address)} · ${data.signature}`,
      );

      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function tradeAll(side: 'buy' | 'sell') {
    if (mintState.status !== 'valid') {
      setNotice('Validate the mint first.');
      return;
    }

    setBusy(`all:${side}`);
    setNotice('');

    try {
      const data = await api('/api/execution/trade-all', {
        method: 'POST',
        body: JSON.stringify({
          mint: mint.trim(),
          side,
          amountSol: Number(buyAmount),
          sellPct: Number(sellPct),
        }),
      });

      const ok = (data.results || []).filter((x: any) => x.ok).length;
      const failed = (data.results || []).length - ok;

      setNotice(
        `${side.toUpperCase()} ALL finished · ${ok} success · ${failed} failed`,
      );

      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  function changeDraft(
    address: string,
    key: keyof (typeof drafts)[string],
    value: string,
  ) {
    setDrafts((prev) => ({
      ...prev,
      [address]: {
        ...(prev[address] || {
          tpPct,
          tpSellPct,
          slPct,
          slSellPct,
        }),
        [key]: value.replace(/[^0-9.]/g, ''),
      },
    }));
  }

  async function saveStrategy(
    wallet: WalletRow,
    enabled: boolean,
    source?: typeof drafts[string],
  ) {
    if (mintState.status !== 'valid') {
      setNotice('Validate the mint first.');
      return;
    }

    const draft =
      source ||
      drafts[wallet.address] || {
        tpPct,
        tpSellPct,
        slPct,
        slSellPct,
      };

    setBusy(`${wallet.address}:strategy`);
    setNotice('');

    try {
      await api('/api/execution/strategy', {
        method: 'POST',
        body: JSON.stringify({
          address: wallet.address,
          mint: mint.trim(),
          enabled,
          tpPct: Number(draft.tpPct),
          tpSellPct: Number(draft.tpSellPct),
          slPct: Number(draft.slPct),
          slSellPct: Number(draft.slSellPct),
        }),
      });

      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function applyToAll() {
    const globalDraft = {
      tpPct,
      tpSellPct,
      slPct,
      slSellPct,
    };

    setDrafts((prev) => {
      const next = { ...prev };
      for (const wallet of wallets) {
        next[wallet.address] = { ...globalDraft };
      }
      return next;
    });

    if (mintState.status !== 'valid') {
      setNotice('Settings copied locally. Validate mint before enabling AUTO.');
      return;
    }

    setBusy('apply-all');

    try {
      for (const wallet of wallets) {
        await saveStrategy(
          wallet,
          wallet.strategy?.enabled ?? false,
          globalDraft,
        );
      }
      setNotice('TP/SL applied to all wallets.');
    } finally {
      setBusy('');
    }
  }

  if (!unlocked) {
    return (
      <main className="page">
        <section className="shell unlock">
          <h1>24/7 EXECUTION</h1>
          <p>
            Enter your private panel access token. This is not a wallet seed
            or private key.
          </p>
          <div className="unlock-row">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && unlock()}
              placeholder="Panel access token"
            />
            <button onClick={unlock}>UNLOCK</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="shell">
        <header className="topbar">
          <h1>24/7 EXECUTION</h1>
          <div className="topbar-actions">
            <button
              className="top-menu-button"
              onClick={openGlobalFunds}
              aria-label="Funds menu"
            >
              •••
            </button>
            <button className="link-button" onClick={lock}>LOCK</button>
          </div>
        </header>

        <section className="section">
          <div className="section-head">
            <span>Execution wallets</span>
            <div className="head-actions">
              <span className="muted">{activeCount} active</span>
              <button
                className="link-button"
                onClick={createWallet}
                disabled={busy === 'create'}
              >
                + CREATE WALLET
              </button>
            </div>
          </div>

          {wallets.length === 0 && (
            <div className="empty">
              Create a dedicated 24/7 trading wallet, then fund its public
              address with a small SOL trading balance.
            </div>
          )}

          <div className="wallet-list">
            {wallets.map((wallet, index) => {
              const draft =
                drafts[wallet.address] || {
                  tpPct,
                  tpSellPct,
                  slPct,
                  slSellPct,
                };

              return (
                <div
                  className={`wallet-row ${wallet.enabled ? '' : 'disabled'}`}
                  key={wallet.id}
                >
                  <div className="wallet-line">
                    <span className="index">
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    <div className="wallet-id">
                      <strong title={wallet.address}>
                        {short(wallet.address)}
                      </strong>
                      <span>{numberText(wallet.sol)} SOL</span>
                    </div>

                    <div className="wallet-tools">
                      <button
                        className="wallet-tool"
                        onClick={() => copyAddress(wallet.address)}
                        aria-label="Copy wallet address"
                      >
                        COPY
                      </button>

                      <button
                        className="wallet-tool refresh"
                        onClick={() => refreshWallet(wallet.address)}
                        disabled={busy === `${wallet.address}:refresh`}
                        aria-label="Refresh wallet balance"
                        title="Refresh balance"
                      >
                        ↻
                      </button>

                      <button
                        className="wallet-tool menu"
                        onClick={() => openWalletFunds(wallet)}
                        aria-label="Wallet funds menu"
                        title="Funds"
                      >
                        •••
                      </button>

                      <span className={`managed ${wallet.enabled ? '' : 'off'}`}>
                        {wallet.enabled ? '24/7' : 'OFF'}
                      </span>
                    </div>
                  </div>

                  <div className="trade-row">
                    <span>BUY</span>
                    <button
                      className="buy"
                      onClick={() => trade(wallet.address, 'buy')}
                      disabled={Boolean(busy) || !wallet.enabled}
                    >
                      BUY
                    </button>
                    <span>SELL</span>
                    <button
                      className="sell"
                      onClick={() => trade(wallet.address, 'sell')}
                      disabled={Boolean(busy) || !wallet.enabled}
                    >
                      SELL
                    </button>
                  </div>

                  <div className="strategy-row">
                    <button
                      className={`auto ${
                        wallet.strategy?.enabled ? 'on' : ''
                      }`}
                      onClick={() =>
                        saveStrategy(
                          wallet,
                          !wallet.strategy?.enabled,
                        )
                      }
                      disabled={Boolean(busy) || !wallet.enabled}
                    >
                      AUTO {wallet.strategy?.enabled ? 'ON' : 'OFF'}
                    </button>

                    <label>
                      TP
                      <input
                        value={draft.tpPct}
                        onChange={(e) =>
                          changeDraft(
                            wallet.address,
                            'tpPct',
                            e.target.value,
                          )
                        }
                      />
                      %
                    </label>

                    <label>
                      SELL
                      <input
                        value={draft.tpSellPct}
                        onChange={(e) =>
                          changeDraft(
                            wallet.address,
                            'tpSellPct',
                            e.target.value,
                          )
                        }
                      />
                      %
                    </label>

                    <label>
                      SL
                      <input
                        value={draft.slPct}
                        onChange={(e) =>
                          changeDraft(
                            wallet.address,
                            'slPct',
                            e.target.value,
                          )
                        }
                      />
                      %
                    </label>

                    <label>
                      SELL
                      <input
                        value={draft.slSellPct}
                        onChange={(e) =>
                          changeDraft(
                            wallet.address,
                            'slSellPct',
                            e.target.value,
                          )
                        }
                      />
                      %
                    </label>

                    <button
                      className="save"
                      onClick={() =>
                        saveStrategy(
                          wallet,
                          wallet.strategy?.enabled ?? false,
                        )
                      }
                      disabled={Boolean(busy)}
                    >
                      SAVE
                    </button>
                  </div>

                  <div className="status-row">
                    <span>
                      ENTRY{' '}
                      {wallet.strategy?.entryPriceSol
                        ? wallet.strategy.entryPriceSol.toExponential(3)
                        : '—'}
                    </span>
                    <strong>
                      P&L{' '}
                      {wallet.pnl == null
                        ? '—'
                        : `${wallet.pnl >= 0 ? '+' : ''}${wallet.pnl.toFixed(1)}%`}
                    </strong>
                    <span>
                      {wallet.strategy?.state?.toUpperCase() || 'IDLE'}
                    </span>
                  </div>

                  {wallet.strategy?.lastError && (
                    <div className="row-error">
                      {wallet.strategy.lastError}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><span>Token</span></div>
          <div className="field-row">
            <input
              value={mint}
              onChange={(e) => {
                setMint(e.target.value);
                setMintState({ status: 'idle' });
              }}
              placeholder="Paste token mint"
              spellCheck="false"
            />
            <button className="link-button" onClick={validate}>
              VALIDATE
            </button>
          </div>
          <div className={`validation ${mintState.status}`}>
            {mintState.status === 'loading' && 'Checking…'}
            {mintState.status === 'valid' &&
              `Valid SPL mint · ${mintState.decimals} decimals`}
            {mintState.status === 'error' && mintState.message}
            {priceSol != null &&
              ` · ${priceSol.toExponential(3)} SOL/token`}
            {priceError && ` · ${priceError}`}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><span>Trade all</span></div>

          <div className="global-grid">
            <label>
              Buy / wallet
              <div><input value={buyAmount} onChange={(e) => setBuyAmount(e.target.value.replace(/[^0-9.]/g, ''))} /><b>SOL</b></div>
            </label>

            <label>
              Sell / wallet
              <div><input value={sellPct} onChange={(e) => setSellPct(e.target.value.replace(/[^0-9.]/g, ''))} /><b>%</b></div>
            </label>
          </div>

          <div className="all-actions">
            <button
              className="primary"
              onClick={() => tradeAll('buy')}
              disabled={Boolean(busy)}
            >
              BUY ALL
            </button>
            <button
              className="secondary"
              onClick={() => tradeAll('sell')}
              disabled={Boolean(busy)}
            >
              SELL ALL
            </button>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span>Auto strategy</span>
            <button
              className="link-button"
              onClick={applyToAll}
              disabled={Boolean(busy)}
            >
              APPLY TO ALL
            </button>
          </div>

          <div className="strategy-global">
            <label>TP <div><input value={tpPct} onChange={(e) => setTpPct(e.target.value.replace(/[^0-9.]/g, ''))}/><b>%</b></div></label>
            <label>TP SELL <div><input value={tpSellPct} onChange={(e) => setTpSellPct(e.target.value.replace(/[^0-9.]/g, ''))}/><b>%</b></div></label>
            <label>SL <div><input value={slPct} onChange={(e) => setSlPct(e.target.value.replace(/[^0-9.]/g, ''))}/><b>%</b></div></label>
            <label>SL SELL <div><input value={slSellPct} onChange={(e) => setSlSellPct(e.target.value.replace(/[^0-9.]/g, ''))}/><b>%</b></div></label>
          </div>

          <p className="note">
            AUTO runs on the server. The phone and browser can be closed.
            Use a Reserved VM deployment so the worker stays online.
          </p>
        </section>


        {(menuWallet || fundsOpen) && (
          <div className="sheet-overlay" onClick={closeFunds}>
            <div
              className="funds-sheet"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sheet-handle" />

              <div className="sheet-head">
                <div>
                  <strong>
                    {menuWallet ? short(menuWallet.address) : 'FUNDS'}
                  </strong>
                  <span>
                    {menuWallet
                      ? `${numberText(menuWallet.sol)} SOL`
                      : `${wallets.length} execution wallets`}
                  </span>
                </div>

                <button className="sheet-close" onClick={closeFunds}>
                  ×
                </button>
              </div>

              <div className="sheet-section">
                <div className="sheet-label-row">
                  <span>Withdrawal address</span>
                  <button onClick={saveWithdrawalAddress}>SAVE DEFAULT</button>
                </div>

                <input
                  value={withdrawAddress}
                  onChange={(event) => setWithdrawAddress(event.target.value)}
                  placeholder="Solana wallet address"
                  spellCheck="false"
                />
              </div>

              {menuWallet ? (
                <>
                  <div className="sheet-section">
                    <div className="sheet-label-row">
                      <span>Amount</span>
                      <button
                        className={withdrawMax ? 'selected' : ''}
                        onClick={() => {
                          setWithdrawMax(true);
                          setWithdrawAmount('');
                        }}
                      >
                        MAX
                      </button>
                    </div>

                    <div className="withdraw-amount-row">
                      <input
                        inputMode="decimal"
                        value={withdrawAmount}
                        disabled={withdrawMax}
                        onChange={(event) => {
                          setWithdrawMax(false);
                          setWithdrawAmount(
                            event.target.value.replace(/[^0-9.]/g, ''),
                          );
                        }}
                        placeholder="0.00"
                      />
                      <span>SOL</span>
                    </div>
                  </div>

                  <button
                    className="sheet-primary"
                    onClick={() => withdrawFromWallet(menuWallet)}
                    disabled={busy === `${menuWallet.address}:withdraw`}
                  >
                    {busy === `${menuWallet.address}:withdraw`
                      ? 'WITHDRAWING…'
                      : withdrawMax
                        ? 'WITHDRAW MAX'
                        : 'WITHDRAW'}
                  </button>

                  <button
                    className="sheet-secondary"
                    onClick={() =>
                      window.open(
                        `https://solscan.io/account/${menuWallet.address}`,
                        '_blank',
                        'noopener,noreferrer',
                      )
                    }
                  >
                    VIEW TRANSACTIONS
                  </button>

                  <div className="wallet-admin">
                    <button
                      className="sheet-secondary"
                      onClick={() =>
                        setWalletEnabled(menuWallet, !menuWallet.enabled)
                      }
                      disabled={busy === `${menuWallet.address}:state`}
                    >
                      {menuWallet.enabled
                        ? 'DISABLE WALLET'
                        : 'ENABLE WALLET'}
                    </button>

                    <button
                      className="sheet-danger"
                      onClick={() => deleteWallet(menuWallet)}
                      disabled={
                        menuWallet.enabled ||
                        busy === `${menuWallet.address}:delete`
                      }
                    >
                      DELETE WALLET
                    </button>
                  </div>

                  <p className="delete-note">
                    Permanent delete is allowed only after the wallet is
                    disabled, AUTO is off, token balances are zero, and only
                    network-fee dust remains.
                  </p>
                </>
              ) : (
                <>
                  <p className="sheet-copy">
                    Withdraw available SOL from every enabled execution wallet
                    to the saved destination. Wallets with AUTO enabled are
                    skipped for safety.
                  </p>

                  <button
                    className="sheet-primary"
                    onClick={withdrawAllWallets}
                    disabled={busy === 'withdraw-all'}
                  >
                    {busy === 'withdraw-all'
                      ? 'WITHDRAWING…'
                      : 'WITHDRAW ALL WALLETS'}
                  </button>
                </>
              )}

              <p className="sheet-footnote">
                MAX leaves a small SOL reserve for the network fee. Disable
                AUTO before draining a wallet.
              </p>
            </div>
          </div>
        )}

        {notice && <div className="notice">{notice}</div>}

        <p className="footnote">
          Dedicated execution-wallet keys are encrypted at rest with your
          Replit secret. Never use a main savings wallet here.
        </p>
      </section>
    </main>
  );
}
