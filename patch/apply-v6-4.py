
from pathlib import Path

HOME = Path("artifacts/solana-multi-wallet/src/pages/home.tsx")
CSS = Path("artifacts/solana-multi-wallet/src/index.css")
ENGINE = Path("artifacts/api-server/src/lib/execution-engine.ts")
ROUTES = Path("artifacts/api-server/src/routes/execution.ts")

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Could not patch {label}: expected block not found")
    return text.replace(old, new, 1)

home = HOME.read_text()

home = replace_once(
    home,
    "import { validateMint } from '@workspace/api-client-react';\n",
    "import { validateMint } from '@workspace/api-client-react';\n\nconst WITHDRAWAL_STORAGE_KEY = 'multi-wallet:withdrawal-address:v1';\n",
    "frontend storage key",
)

home = replace_once(
    home,
    "  const [busy, setBusy] = useState('');\n  const [notice, setNotice] = useState('');\n",
    '''  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const [menuWallet, setMenuWallet] = useState<WalletRow | null>(null);
  const [fundsOpen, setFundsOpen] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState(
    () => localStorage.getItem(WITHDRAWAL_STORAGE_KEY) || '',
  );
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawMax, setWithdrawMax] = useState(false);
''',
    "frontend withdrawal state",
)

insert_before_validate = '''
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

'''

home = replace_once(
    home,
    "  async function validate() {\n",
    insert_before_validate + "  async function validate() {\n",
    "frontend withdrawal functions",
)

home = replace_once(
    home,
    '''        <header className="topbar">
          <h1>24/7 EXECUTION</h1>
          <button className="link-button" onClick={lock}>LOCK</button>
        </header>
''',
    '''        <header className="topbar">
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
''',
    "frontend top funds menu",
)

home = replace_once(
    home,
    '''                      <button
                        className="wallet-tool refresh"
                        onClick={() => refreshWallet(wallet.address)}
                        disabled={busy === `${wallet.address}:refresh`}
                        aria-label="Refresh wallet balance"
                        title="Refresh balance"
                      >
                        ↻
                      </button>

                      <span className="managed">24/7</span>
''',
    '''                      <button
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

                      <span className="managed">24/7</span>
''',
    "frontend wallet menu button",
)

sheet_jsx = '''
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

'''

home = replace_once(
    home,
    '        {notice && <div className="notice">{notice}</div>}\n',
    sheet_jsx + '        {notice && <div className="notice">{notice}</div>}\n',
    "frontend bottom sheet",
)

HOME.write_text(home)

css = CSS.read_text()
css += '''

.topbar-actions { display:flex; align-items:center; gap:10px; }
.top-menu-button {
  width:30px;
  height:28px;
  border:0;
  background:transparent;
  color:#111;
  font-size:14px;
  font-weight:750;
  letter-spacing:.08em;
  padding:0;
}
.wallet-tool.menu { min-width:30px; font-size:10px; letter-spacing:.05em; }

.sheet-overlay {
  position:fixed;
  inset:0;
  z-index:80;
  background:rgba(0,0,0,.28);
  display:flex;
  align-items:flex-end;
  justify-content:center;
}
.funds-sheet {
  width:min(760px,100%);
  background:#fff;
  border-radius:16px 16px 0 0;
  padding:8px 16px calc(18px + env(safe-area-inset-bottom));
  box-shadow:0 -12px 40px rgba(0,0,0,.12);
}
.sheet-handle {
  width:34px;
  height:4px;
  border-radius:999px;
  background:#d7d7d7;
  margin:0 auto 12px;
}
.sheet-head {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding-bottom:10px;
  border-bottom:1px solid #ededed;
}
.sheet-head>div { display:flex; flex-direction:column; gap:2px; }
.sheet-head strong { font-size:13px; }
.sheet-head span { color:#888; font-size:9px; }
.sheet-close {
  width:30px;
  height:30px;
  border:0;
  background:transparent;
  font-size:22px;
  line-height:1;
  color:#666;
}
.sheet-section { padding-top:12px; }
.sheet-label-row {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:5px;
  color:#777;
  font-size:9px;
}
.sheet-label-row button {
  border:0;
  background:transparent;
  color:#111;
  font-size:8px;
  font-weight:750;
  padding:3px 0;
}
.sheet-label-row button.selected { text-decoration:underline; }
.withdraw-amount-row {
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  align-items:center;
  gap:6px;
}
.withdraw-amount-row input { text-align:right; }
.withdraw-amount-row span { color:#777; font-size:9px; }
.sheet-primary,
.sheet-secondary {
  width:100%;
  height:42px;
  border-radius:9px;
  margin-top:12px;
  font-size:9px;
  font-weight:750;
  letter-spacing:.05em;
}
.sheet-primary { border:1px solid #111; background:#111; color:#fff; }
.sheet-secondary { border:1px solid #111; background:#fff; color:#111; }
.sheet-copy {
  margin:12px 0 0;
  color:#777;
  font-size:9px;
  line-height:1.4;
}
.sheet-footnote {
  margin:10px 0 0;
  color:#999;
  text-align:center;
  font-size:8px;
  line-height:1.35;
}
'''
CSS.write_text(css)

engine = ENGINE.read_text()
engine = replace_once(
    engine,
    '  PublicKey,\n  VersionedTransaction,\n} from "@solana/web3.js";\n',
    '  PublicKey,\n  SystemProgram,\n  Transaction,\n  VersionedTransaction,\n} from "@solana/web3.js";\n',
    "engine imports",
)

engine += '''

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
'''
ENGINE.write_text(engine)

routes = ROUTES.read_text()
routes = replace_once(
    routes,
    '  executeSellPercent,\n  walletSolBalance,\n} from "../lib/execution-engine";\n',
    '  executeSellPercent,\n  walletSolBalance,\n  withdrawSol,\n} from "../lib/execution-engine";\n',
    "route imports",
)

withdraw_routes = '''

router.post("/execution/withdraw", async (req, res): Promise<void> => {
  const { address, to, amountSol, max } = req.body ?? {};

  if (
    typeof address !== "string" ||
    typeof to !== "string" ||
    typeof max !== "boolean"
  ) {
    res.status(400).json({ error: "Invalid withdrawal request" });
    return;
  }

  try {
    new PublicKey(address);
    new PublicKey(to);
  } catch {
    res.status(400).json({ error: "Invalid Solana address" });
    return;
  }

  const wallet = await findWallet(address);
  if (!wallet || !wallet.enabled) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  if (max) {
    const activeStrategies = await db
      .select({ id: executionStrategiesTable.id })
      .from(executionStrategiesTable)
      .where(
        and(
          eq(executionStrategiesTable.walletId, wallet.id),
          eq(executionStrategiesTable.enabled, true),
        ),
      )
      .limit(1);

    if (activeStrategies.length) {
      res.status(409).json({
        error: "Disable AUTO before withdrawing MAX from this wallet",
      });
      return;
    }
  }

  try {
    const keypair = Keypair.fromSecretKey(
      decryptSecret(wallet.encryptedSecret),
    );

    const result = await withdrawSol(
      keypair,
      to,
      max ? undefined : Number(amountSol),
      max,
    );

    res.json({
      status: "success",
      address,
      to,
      ...result,
    });
  } catch (error) {
    req.log.error({ err: error }, "Managed withdrawal failed");
    res.status(422).json({
      error:
        error instanceof Error
          ? error.message
          : "Withdrawal failed",
    });
  }
});

router.post("/execution/withdraw-all", async (req, res): Promise<void> => {
  const { to } = req.body ?? {};

  if (typeof to !== "string") {
    res.status(400).json({ error: "Invalid withdrawal-all request" });
    return;
  }

  try {
    new PublicKey(to);
  } catch {
    res.status(400).json({ error: "Invalid destination address" });
    return;
  }

  const wallets = await db
    .select()
    .from(executionWalletsTable)
    .where(eq(executionWalletsTable.enabled, true));

  const results: Array<Record<string, unknown>> = [];

  for (const wallet of wallets) {
    try {
      const activeStrategies = await db
        .select({ id: executionStrategiesTable.id })
        .from(executionStrategiesTable)
        .where(
          and(
            eq(executionStrategiesTable.walletId, wallet.id),
            eq(executionStrategiesTable.enabled, true),
          ),
        )
        .limit(1);

      if (activeStrategies.length) {
        results.push({
          address: wallet.address,
          ok: false,
          error: "AUTO is enabled; wallet skipped",
        });
        continue;
      }

      const keypair = Keypair.fromSecretKey(
        decryptSecret(wallet.encryptedSecret),
      );

      const result = await withdrawSol(
        keypair,
        to,
        undefined,
        true,
      );

      results.push({
        address: wallet.address,
        ok: true,
        signature: result.signature,
        amountSol: result.amountSol,
      });
    } catch (error) {
      results.push({
        address: wallet.address,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  res.json({ results });
});
'''

routes = replace_once(
    routes,
    '\nexport default router;\n',
    withdraw_routes + '\nexport default router;\n',
    "withdraw routes",
)
ROUTES.write_text(routes)

print("v6.4 funds menu patch applied.")
