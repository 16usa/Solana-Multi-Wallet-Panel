import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { validateMint } from '@workspace/api-client-react';

const WITHDRAWAL_STORAGE_KEY = 'multi-wallet:withdrawal-address:v1';
const THEME_STORAGE_KEY = 'multi-wallet:theme:v1';
const TRADE_DRAFTS_STORAGE_KEY = 'multi-wallet:trade-drafts:v1';
const CURRENCY_STORAGE_KEY = 'multi-wallet:currency:v1';
const BUY_AMOUNT_STORAGE_KEY = 'multi-wallet:buy-amount:v1';

type CurrencyMode = 'sol' | 'usd';

type Strategy = {
  enabled: boolean;
  tpPct: number;
  tpSellPct: number;
  slPct: number;
  slSellPct: number;
  entryPriceSol?: number | null;
  positionCostSol?: number;
  totalInvestedSol?: number;
  realizedPnlSol?: number;
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
  tokenBalance?: number;
  positionCostSol?: number;
  totalInvestedSol?: number;
  realizedPnlSol?: number;
  unrealizedPnlSol?: number | null;
  totalPnlSol?: number | null;
  totalPnlPct?: number | null;
};

type PnlSummary = {
  totalPnlSol: number | null;
  totalPnlPct: number | null;
  realizedPnlSol: number;
  unrealizedPnlSol: number | null;
  totalInvestedSol: number;
};


type CopyTarget = {
  id: string;
  walletId: string;
  address: string;
  walletEnabled: boolean;
  enabled: boolean;
  buyAmount: number;
  buyCurrency: CurrencyMode;
};

type CopySource = {
  id: string;
  address: string;
  enabled: boolean;
  copyBuys: boolean;
  copySells: boolean;
  mode: 'follow-source' | 'copy-buy-auto';
  maxBuyAmount: number;
  maxBuyCurrency: CurrencyMode;
  slippagePct: number;
  delayMs: number;
  autoTpPct: number;
  autoTpSellPct: number;
  autoSlPct: number;
  autoSlSellPct: number;
  targets: CopyTarget[];
};

type CopyHistory = {
  id: string;
  sourceAddress: string;
  sourceSignature: string;
  mint: string;
  side: 'buy' | 'sell';
  sourceSellPct?: number | null;
  status: string;
  error?: string | null;
  createdAt: string;
  executions: Array<{
    id: string;
    walletAddress: string;
    status: string;
    amountSol?: number | null;
    sellPct?: number | null;
    signature?: string | null;
    error?: string | null;
  }>;
};

type CopyState = {
  enabled: boolean;
  sources: CopySource[];
  history: CopyHistory[];
};

const short = (value: string) =>
  `${value.slice(0, 5)}…${value.slice(-5)}`;

const numberText = (value: number | null | undefined, digits = 4) =>
  value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);

const signedPctText = (
  value: number | null | undefined,
  digits = 2,
) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;

export default function Home() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem('panel-token') || '',
  );
  const [tokenInput, setTokenInput] = useState(token);
  const [unlocked, setUnlocked] = useState(Boolean(token));
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [currency, setCurrency] = useState<CurrencyMode>(() => {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    return saved === 'usd' ? 'usd' : 'sol';
  });
  const [solUsd, setSolUsd] = useState<number | null>(null);

  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [mint, setMint] = useState('');
  const [mintState, setMintState] = useState<any>({ status: 'idle' });
  const [priceSol, setPriceSol] = useState<number | null>(null);
  const [priceError, setPriceError] = useState('');
  const [pnlSummary, setPnlSummary] = useState<PnlSummary | null>(null);

  const [buyAmount, setBuyAmount] = useState(
    () => localStorage.getItem(BUY_AMOUNT_STORAGE_KEY) || '0.01',
  );
  const [sellPct, setSellPct] = useState('100');

  const [tradeDrafts, setTradeDrafts] = useState<
    Record<string, { buyAmount: string; sellPct: string }>
  >(() => {
    try {
      const saved = localStorage.getItem(TRADE_DRAFTS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

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


  const [copyOpen, setCopyOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>({
    enabled: false,
    sources: [],
    history: [],
  });
  const [copySourceInput, setCopySourceInput] = useState('');

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

  const refreshCopyTrading = useCallback(async () => {
    if (!unlocked || !token) return;

    try {
      const data = await api('/api/copy-trading');
      setCopyState(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [api, token, unlocked]);

  const refresh = useCallback(async () => {
    if (!unlocked || !token) return;

    try {
      const priceData = await api('/api/execution/sol-usd');
      const nextSolUsd = Number(priceData.usdPrice);
      setSolUsd(
        Number.isFinite(nextSolUsd) && nextSolUsd > 0
          ? nextSolUsd
          : null,
      );
    } catch {
      setSolUsd(null);
    }

    try {
      if (mintState.status === 'valid' && mint.trim()) {
        const data = await api(
          `/api/execution/state?mint=${encodeURIComponent(mint.trim())}`,
        );

        setWallets(data.wallets || []);
        setPriceSol(data.priceSol ?? null);
        setPriceError(data.priceError || '');
        setPnlSummary(data.summary || null);

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
        setPnlSummary(null);
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
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem(BUY_AMOUNT_STORAGE_KEY, buyAmount);
  }, [buyAmount]);

  useEffect(() => {
    localStorage.setItem(
      TRADE_DRAFTS_STORAGE_KEY,
      JSON.stringify(tradeDrafts),
    );
  }, [tradeDrafts]);

  useEffect(() => {
    if (!unlocked) return;
    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [unlocked, refresh]);

  useEffect(() => {
    if (!copyOpen || !unlocked) return;

    void refreshCopyTrading();

    const timer = window.setInterval(() => {
      void refreshCopyTrading();
    }, 3500);

    return () => window.clearInterval(timer);
  }, [copyOpen, unlocked, refreshCopyTrading]);

  const activeCount = useMemo(
    () => wallets.filter((w) => w.enabled).length,
    [wallets],
  );

  const moneyUnit = currency === 'usd' ? 'USD' : 'SOL';

  function trimAmount(value: number, digits: number) {
    return value
      .toFixed(digits)
      .replace(/\.?0+$/, '');
  }

  function convertInputAmount(
    value: string,
    from: CurrencyMode,
    to: CurrencyMode,
    rate = solUsd,
  ) {
    if (from === to || !value) return value;

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || !rate) {
      return value;
    }

    return to === 'usd'
      ? trimAmount(numeric * rate, 2)
      : trimAmount(numeric / rate, 6);
  }

  function amountInputToSol(value: string): number | null {
    const numeric = Number(value);

    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    if (currency === 'usd') {
      if (!solUsd || solUsd <= 0) return null;
      return numeric / solUsd;
    }

    return numeric;
  }

  function moneyText(
    solValue: number | null | undefined,
    signed = false,
  ) {
    if (
      solValue == null ||
      !Number.isFinite(solValue)
    ) {
      return '—';
    }

    if (currency === 'usd') {
      if (!solUsd) return '—';
      const usd = solValue * solUsd;
      return `${signed && usd > 0 ? '+' : ''}$${usd.toFixed(2)}`;
    }

    return `${signed && solValue > 0 ? '+' : ''}${solValue.toFixed(4)} SOL`;
  }

  function tokenPriceText(
    solValue: number | null | undefined,
  ) {
    if (
      solValue == null ||
      !Number.isFinite(solValue)
    ) {
      return '—';
    }

    if (currency === 'usd') {
      if (!solUsd) return '—';
      const usd = solValue * solUsd;
      return `$${usd.toExponential(3)}`;
    }

    return `${solValue.toExponential(3)} SOL`;
  }

  async function switchCurrency() {
    const next: CurrencyMode =
      currency === 'sol' ? 'usd' : 'sol';

    let rate = solUsd;

    if (!rate) {
      try {
        const data = await api('/api/execution/sol-usd');
        const nextRate = Number(data.usdPrice);

        if (Number.isFinite(nextRate) && nextRate > 0) {
          rate = nextRate;
          setSolUsd(nextRate);
        }
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Live SOL/USD price is unavailable.',
        );
        return;
      }
    }

    if (!rate) {
      setNotice('Live SOL/USD price is unavailable.');
      return;
    }

    setBuyAmount((value) =>
      convertInputAmount(value, currency, next, rate),
    );

    setTradeDrafts((prev) => {
      const converted: typeof prev = {};

      for (const [address, draft] of Object.entries(prev)) {
        converted[address] = {
          ...draft,
          buyAmount: convertInputAmount(
            draft.buyAmount,
            currency,
            next,
            rate,
          ),
        };
      }

      return converted;
    });

    if (!withdrawMax && withdrawAmount) {
      setWithdrawAmount((value) =>
        convertInputAmount(value, currency, next, rate),
      );
    }

    setCurrency(next);
    setNotice('');
  }

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


  function openCopyTrading() {
    setMenuWallet(null);
    setFundsOpen(false);
    setCopyOpen(true);
    setNotice('');
    void refreshCopyTrading();
  }

  function closeCopyTrading() {
    setCopyOpen(false);
  }

  async function setCopyMaster(enabled: boolean) {
    setBusy('copy-master');

    try {
      const data = await api('/api/copy-trading/control', {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      setCopyState(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function addCopySource() {
    const address = copySourceInput.trim();
    if (!address) return;

    setBusy('copy-add');

    try {
      const data = await api('/api/copy-trading/source', {
        method: 'POST',
        body: JSON.stringify({ address }),
      });
      setCopyState(data);
      setCopySourceInput('');
      setNotice(`Copy source added · ${short(address)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  function changeCopySource(
    sourceId: string,
    key: keyof CopySource,
    value: any,
  ) {
    setCopyState((prev) => ({
      ...prev,
      sources: prev.sources.map((source) =>
        source.id === sourceId
          ? { ...source, [key]: value }
          : source,
      ),
    }));
  }

  function changeCopyTarget(
    sourceId: string,
    walletId: string,
    key: keyof CopyTarget,
    value: any,
  ) {
    setCopyState((prev) => ({
      ...prev,
      sources: prev.sources.map((source) =>
        source.id === sourceId
          ? {
              ...source,
              targets: source.targets.map((target) =>
                target.walletId === walletId
                  ? { ...target, [key]: value }
                  : target,
              ),
            }
          : source,
      ),
    }));
  }

  async function saveCopySource(source: CopySource) {
    setBusy(`copy-save:${source.id}`);

    try {
      const data = await api(
        `/api/copy-trading/source/${encodeURIComponent(source.id)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            enabled: source.enabled,
            copyBuys: source.copyBuys,
            copySells: source.copySells,
            mode: source.mode,
            maxBuyAmount: Number(source.maxBuyAmount),
            maxBuyCurrency: source.maxBuyCurrency,
            slippagePct: Number(source.slippagePct),
            delayMs: Number(source.delayMs),
            autoTpPct: Number(source.autoTpPct),
            autoTpSellPct: Number(source.autoTpSellPct),
            autoSlPct: Number(source.autoSlPct),
            autoSlSellPct: Number(source.autoSlSellPct),
            targets: source.targets.map((target) => ({
              walletId: target.walletId,
              enabled: target.enabled,
              buyAmount: Number(target.buyAmount),
              buyCurrency: target.buyCurrency,
            })),
          }),
        },
      );

      setCopyState(data);
      setNotice(`Copy source saved · ${short(source.address)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function deleteCopySource(source: CopySource) {
    if (
      !window.confirm(
        `Remove copy source ${short(source.address)}?`,
      )
    ) {
      return;
    }

    setBusy(`copy-delete:${source.id}`);

    try {
      const data = await api(
        `/api/copy-trading/source/${encodeURIComponent(source.id)}`,
        { method: 'DELETE' },
      );
      setCopyState(data);
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
    const amountSol = amountInputToSol(withdrawAmount);

    if (!to) {
      setNotice('Enter a withdrawal address.');
      return;
    }

    if (
      !withdrawMax &&
      (
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amountSol == null
      )
    ) {
      setNotice(
        `Enter a valid ${moneyUnit} amount or choose MAX.`,
      );
      return;
    }

    const label = withdrawMax
      ? 'MAX'
      : currency === 'usd'
        ? `$${amount.toFixed(2)}`
        : `${amount} SOL`;
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
          amountSol: withdrawMax ? undefined : amountSol,
          max: withdrawMax,
        }),
      });

      setNotice(
        `Withdrawal confirmed · ${moneyText(data.amountSol)} · ${data.signature}`,
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

  function changeTradeDraft(
    address: string,
    key: 'buyAmount' | 'sellPct',
    value: string,
  ) {
    const cleaned = value.replace(/[^0-9.]/g, '');

    setTradeDrafts((prev) => ({
      ...prev,
      [address]: {
        buyAmount:
          key === 'buyAmount'
            ? cleaned
            : prev[address]?.buyAmount ?? buyAmount,
        sellPct:
          key === 'sellPct'
            ? cleaned
            : prev[address]?.sellPct ?? sellPct,
      },
    }));
  }

  async function trade(
    address: string,
    side: 'buy' | 'sell',
  ) {
    if (mintState.status !== 'valid') {
      setNotice('Validate the mint first.');
      return;
    }

    const walletTrade = tradeDrafts[address] || {
      buyAmount,
      sellPct,
    };

    const walletBuyValue = Number(walletTrade.buyAmount);
    const walletBuyAmount = amountInputToSol(
      walletTrade.buyAmount,
    );
    const walletSellPct = Number(walletTrade.sellPct);

    if (
      side === 'buy' &&
      (
        !Number.isFinite(walletBuyValue) ||
        walletBuyValue <= 0 ||
        walletBuyAmount == null
      )
    ) {
      setNotice(`Enter a valid BUY amount for ${short(address)}.`);
      return;
    }

    if (
      side === 'sell' &&
      (
        !Number.isFinite(walletSellPct) ||
        walletSellPct <= 0 ||
        walletSellPct > 100
      )
    ) {
      setNotice(`SELL % for ${short(address)} must be 1–100.`);
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
          amountSol: walletBuyAmount,
          sellPct: walletSellPct,
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

    const buyAmountSol = amountInputToSol(buyAmount);

    if (
      side === 'buy' &&
      buyAmountSol == null
    ) {
      setNotice(`Enter a valid ${moneyUnit} BUY ALL amount.`);
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
          amountSol: buyAmountSol,
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
          <div className="title-with-theme">
            <h1>24/7 EXECUTION</h1>
            <button
            className={`theme-toggle ${theme === 'dark' ? 'on' : ''}`}
            onClick={() =>
              setTheme((current) =>
                current === 'dark' ? 'light' : 'dark',
              )
            }
            aria-label={
              theme === 'dark'
                ? 'Switch to light mode'
                : 'Switch to dark mode'
            }
            aria-pressed={theme === 'dark'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            <span />
          </button>
          <button
            className={`currency-toggle ${currency === 'usd' ? 'usd' : ''}`}
            onClick={switchCurrency}
            aria-label={
              currency === 'usd'
                ? 'Show amounts in SOL'
                : 'Show amounts in USD'
            }
            aria-pressed={currency === 'usd'}
            title={`Display in ${currency === 'usd' ? 'SOL' : 'USD'}`}
          >
            <span>SOL</span>
            <span>USD</span>
          </button>
          </div>
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
          <div className="title-with-theme">
            <h1>24/7 EXECUTION</h1>
            <button
            className={`theme-toggle ${theme === 'dark' ? 'on' : ''}`}
            onClick={() =>
              setTheme((current) =>
                current === 'dark' ? 'light' : 'dark',
              )
            }
            aria-label={
              theme === 'dark'
                ? 'Switch to light mode'
                : 'Switch to dark mode'
            }
            aria-pressed={theme === 'dark'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            <span />
          </button>
          <button
            className={`currency-toggle ${currency === 'usd' ? 'usd' : ''}`}
            onClick={switchCurrency}
            aria-label={
              currency === 'usd'
                ? 'Show amounts in SOL'
                : 'Show amounts in USD'
            }
            aria-pressed={currency === 'usd'}
            title={`Display in ${currency === 'usd' ? 'SOL' : 'USD'}`}
          >
            <span>SOL</span>
            <span>USD</span>
          </button>
          </div>
          <div className="topbar-actions">
            <button
              className={`copy-open-button ${copyState.enabled ? 'on' : ''}`}
              onClick={openCopyTrading}
              aria-label="Copy trading"
              title="Copy trading"
            >
              COPY
            </button>
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

              const tradeDraft =
                tradeDrafts[wallet.address] || {
                  buyAmount,
                  sellPct,
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
                      <span>{moneyText(wallet.sol)}</span>
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

                    <div className="trade-value">
                      <input
                        inputMode="decimal"
                        value={tradeDraft.buyAmount}
                        onChange={(event) =>
                          changeTradeDraft(
                            wallet.address,
                            'buyAmount',
                            event.target.value,
                          )
                        }
                        aria-label={`Buy amount for ${wallet.address}`}
                      />
                      <b>{moneyUnit}</b>
                    </div>

                    <button
                      className="buy"
                      onClick={() => trade(wallet.address, 'buy')}
                      disabled={Boolean(busy) || !wallet.enabled}
                    >
                      BUY
                    </button>

                    <span>SELL</span>

                    <div className="trade-value">
                      <input
                        inputMode="decimal"
                        value={tradeDraft.sellPct}
                        onChange={(event) =>
                          changeTradeDraft(
                            wallet.address,
                            'sellPct',
                            event.target.value,
                          )
                        }
                        aria-label={`Sell percentage for ${wallet.address}`}
                      />
                      <b>%</b>
                    </div>

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
                        ? tokenPriceText(wallet.strategy.entryPriceSol)
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
                setPnlSummary(null);
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
              ` · ${tokenPriceText(priceSol)}/token`}
            {priceError && ` · ${priceError}`}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><span>Trade all</span></div>

          <div className="pnl-summary">
            <div className="pnl-summary-main">
              <span>TOTAL P&amp;L</span>
              <strong>
                {moneyText(pnlSummary?.totalPnlSol, true)}
                <b>{signedPctText(pnlSummary?.totalPnlPct)}</b>
              </strong>
            </div>

            <div className="pnl-summary-split">
              <span>
                REALIZED
                <b>{moneyText(pnlSummary?.realizedPnlSol, true)}</b>
              </span>
              <span>
                UNREALIZED
                <b>{moneyText(pnlSummary?.unrealizedPnlSol, true)}</b>
              </span>
            </div>
          </div>

          <div className="global-grid">
            <label>
              Buy / wallet
              <div><input value={buyAmount} onChange={(e) => setBuyAmount(e.target.value.replace(/[^0-9.]/g, ''))} /><b>{moneyUnit}</b></div>
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


        {copyOpen && (
          <div className="sheet-overlay" onClick={closeCopyTrading}>
            <div
              className="funds-sheet copy-sheet"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sheet-handle" />

              <div className="sheet-head">
                <div>
                  <strong>COPY TRADING</strong>
                  <span>
                    {copyState.sources.length} source
                    {copyState.sources.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="copy-head-actions">
                  <button
                    className={`copy-master ${copyState.enabled ? 'on' : ''}`}
                    onClick={() => setCopyMaster(!copyState.enabled)}
                    disabled={busy === 'copy-master'}
                  >
                    {copyState.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button className="sheet-close" onClick={closeCopyTrading}>
                    ×
                  </button>
                </div>
              </div>

              <div className="copy-add">
                <input
                  value={copySourceInput}
                  onChange={(event) =>
                    setCopySourceInput(event.target.value)
                  }
                  placeholder="Source Solana wallet"
                  spellCheck="false"
                />
                <button
                  onClick={addCopySource}
                  disabled={busy === 'copy-add'}
                >
                  + ADD
                </button>
              </div>

              {copyState.sources.length === 0 && (
                <p className="sheet-copy">
                  Add a source wallet. New sources start from the latest
                  transaction, so old history is not copied.
                </p>
              )}

              {copyState.sources.map((source) => (
                <div className="copy-source" key={source.id}>
                  <div className="copy-source-head">
                    <div>
                      <strong title={source.address}>
                        {short(source.address)}
                      </strong>
                      <span>
                        {source.enabled ? 'WATCHING' : 'PAUSED'}
                      </span>
                    </div>

                    <div>
                      <button
                        className={`copy-chip ${source.enabled ? 'on' : ''}`}
                        onClick={() =>
                          changeCopySource(
                            source.id,
                            'enabled',
                            !source.enabled,
                          )
                        }
                      >
                        {source.enabled ? 'ON' : 'OFF'}
                      </button>
                      <button
                        className="copy-delete"
                        onClick={() => deleteCopySource(source)}
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="copy-mode">
                    <button
                      className={
                        source.mode === 'follow-source'
                          ? 'selected'
                          : ''
                      }
                      onClick={() =>
                        changeCopySource(
                          source.id,
                          'mode',
                          'follow-source',
                        )
                      }
                    >
                      FOLLOW SOURCE
                    </button>
                    <button
                      className={
                        source.mode === 'copy-buy-auto'
                          ? 'selected'
                          : ''
                      }
                      onClick={() =>
                        changeCopySource(
                          source.id,
                          'mode',
                          'copy-buy-auto',
                        )
                      }
                    >
                      COPY BUY + AUTO
                    </button>
                  </div>

                  <div className="copy-switches">
                    <label>
                      <input
                        type="checkbox"
                        checked={source.copyBuys}
                        onChange={(event) =>
                          changeCopySource(
                            source.id,
                            'copyBuys',
                            event.target.checked,
                          )
                        }
                      />
                      COPY BUY
                    </label>

                    <label>
                      <input
                        type="checkbox"
                        checked={source.copySells}
                        disabled={source.mode === 'copy-buy-auto'}
                        onChange={(event) =>
                          changeCopySource(
                            source.id,
                            'copySells',
                            event.target.checked,
                          )
                        }
                      />
                      SAME-% SELL
                    </label>
                  </div>

                  <div className="copy-settings">
                    <label>
                      MAX BUY
                      <div>
                        <input
                          inputMode="decimal"
                          value={source.maxBuyAmount}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'maxBuyAmount',
                              event.target.value.replace(/[^0-9.]/g, ''),
                            )
                          }
                        />
                        <select
                          value={source.maxBuyCurrency}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'maxBuyCurrency',
                              event.target.value,
                            )
                          }
                        >
                          <option value="sol">SOL</option>
                          <option value="usd">USD</option>
                        </select>
                      </div>
                    </label>

                    <label>
                      SLIPPAGE
                      <div>
                        <input
                          inputMode="decimal"
                          value={source.slippagePct}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'slippagePct',
                              event.target.value.replace(/[^0-9.]/g, ''),
                            )
                          }
                        />
                        <b>%</b>
                      </div>
                    </label>

                    <label>
                      DELAY
                      <div>
                        <input
                          inputMode="numeric"
                          value={source.delayMs}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'delayMs',
                              event.target.value.replace(/[^0-9]/g, ''),
                            )
                          }
                        />
                        <b>MS</b>
                      </div>
                    </label>
                  </div>

                  {source.mode === 'copy-buy-auto' && (
                    <div className="copy-auto-grid">
                      <label>
                        TP
                        <input
                          value={source.autoTpPct}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'autoTpPct',
                              event.target.value.replace(/[^0-9.]/g, ''),
                            )
                          }
                        />
                        %
                      </label>
                      <label>
                        TP SELL
                        <input
                          value={source.autoTpSellPct}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'autoTpSellPct',
                              event.target.value.replace(/[^0-9.]/g, ''),
                            )
                          }
                        />
                        %
                      </label>
                      <label>
                        SL
                        <input
                          value={source.autoSlPct}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'autoSlPct',
                              event.target.value.replace(/[^0-9.]/g, ''),
                            )
                          }
                        />
                        %
                      </label>
                      <label>
                        SL SELL
                        <input
                          value={source.autoSlSellPct}
                          onChange={(event) =>
                            changeCopySource(
                              source.id,
                              'autoSlSellPct',
                              event.target.value.replace(/[^0-9.]/g, ''),
                            )
                          }
                        />
                        %
                      </label>
                    </div>
                  )}

                  <div className="copy-target-title">
                    EXECUTION WALLETS
                  </div>

                  <div className="copy-targets">
                    {source.targets.map((target) => (
                      <div
                        className={`copy-target ${
                          target.walletEnabled ? '' : 'disabled'
                        }`}
                        key={target.walletId}
                      >
                        <input
                          type="checkbox"
                          checked={target.enabled}
                          disabled={!target.walletEnabled}
                          onChange={(event) =>
                            changeCopyTarget(
                              source.id,
                              target.walletId,
                              'enabled',
                              event.target.checked,
                            )
                          }
                        />
                        <strong title={target.address}>
                          {short(target.address)}
                        </strong>
                        <input
                          inputMode="decimal"
                          value={target.buyAmount}
                          onChange={(event) =>
                            changeCopyTarget(
                              source.id,
                              target.walletId,
                              'buyAmount',
                              event.target.value.replace(/[^0-9.]/g, ''),
                            )
                          }
                        />
                        <select
                          value={target.buyCurrency}
                          onChange={(event) =>
                            changeCopyTarget(
                              source.id,
                              target.walletId,
                              'buyCurrency',
                              event.target.value,
                            )
                          }
                        >
                          <option value="sol">SOL</option>
                          <option value="usd">USD</option>
                        </select>
                      </div>
                    ))}
                  </div>

                  <button
                    className="sheet-primary"
                    onClick={() => saveCopySource(source)}
                    disabled={busy === `copy-save:${source.id}`}
                  >
                    SAVE SOURCE
                  </button>

                  <p className="copy-note">
                    FOLLOW SOURCE copies fixed-size buys and the same sell
                    percentage. COPY BUY + AUTO ignores source sells and uses
                    this source's TP/SL for exits.
                  </p>
                </div>
              ))}

              <div className="copy-history">
                <div className="copy-target-title">HISTORY</div>

                {copyState.history.length === 0 && (
                  <div className="empty">No copied trades yet.</div>
                )}

                {copyState.history.slice(0, 12).map((event) => {
                  const copied = event.executions.filter(
                    (item) => item.status === 'copied',
                  ).length;
                  const failed = event.executions.filter(
                    (item) => item.status === 'failed',
                  ).length;

                  return (
                    <div className="copy-history-row" key={event.id}>
                      <div>
                        <strong>
                          {event.side.toUpperCase()} {short(event.mint)}
                        </strong>
                        <span>
                          {short(event.sourceAddress)} · {event.status.toUpperCase()}
                        </span>
                      </div>
                      <b>
                        {copied} OK
                        {failed > 0 ? ` · ${failed} FAIL` : ''}
                      </b>
                    </div>
                  );
                })}
              </div>

              <p className="sheet-footnote">
                Copy trading runs on the server. Keep the API deployment
                online 24/7. Duplicate source signatures are ignored.
              </p>
            </div>
          </div>
        )}

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
                      ? moneyText(menuWallet.sol)
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
                      <span>{moneyUnit}</span>
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
