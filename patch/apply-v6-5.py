
from pathlib import Path

HOME = Path("artifacts/solana-multi-wallet/src/pages/home.tsx")
CSS = Path("artifacts/solana-multi-wallet/src/index.css")
ENGINE = Path("artifacts/api-server/src/lib/execution-engine.ts")
ROUTES = Path("artifacts/api-server/src/routes/execution.ts")

def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Could not patch {label}: expected block not found")
    return text.replace(old, new, 1)

# ---------- frontend ----------
home = HOME.read_text()

manage_functions = '''
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

'''

home = replace_once(
    home,
    "  async function validate() {\n",
    manage_functions + "  async function validate() {\n",
    "wallet management functions",
)

home = replace_once(
    home,
    '                <div className="wallet-row" key={wallet.id}>\n',
    '''                <div
                  className={`wallet-row ${wallet.enabled ? '' : 'disabled'}`}
                  key={wallet.id}
                >
''',
    "wallet disabled class",
)

home = replace_once(
    home,
    '                      <span className="managed">24/7</span>\n',
    '''                      <span className={`managed ${wallet.enabled ? '' : 'off'}`}>
                        {wallet.enabled ? '24/7' : 'OFF'}
                      </span>
''',
    "wallet enabled badge",
)

home = replace_once(
    home,
    '''                      disabled={Boolean(busy)}
                    >
                      BUY
''',
    '''                      disabled={Boolean(busy) || !wallet.enabled}
                    >
                      BUY
''',
    "disable buy when wallet off",
)

home = replace_once(
    home,
    '''                      disabled={Boolean(busy)}
                    >
                      SELL
''',
    '''                      disabled={Boolean(busy) || !wallet.enabled}
                    >
                      SELL
''',
    "disable sell when wallet off",
)

home = replace_once(
    home,
    '''                      disabled={Boolean(busy)}
                    >
                      AUTO {wallet.strategy?.enabled ? 'ON' : 'OFF'}
''',
    '''                      disabled={Boolean(busy) || !wallet.enabled}
                    >
                      AUTO {wallet.strategy?.enabled ? 'ON' : 'OFF'}
''',
    "disable auto button when wallet off",
)

sheet_target = '''                  <button
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
'''

sheet_replacement = sheet_target + '''
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
'''

home = replace_once(
    home,
    sheet_target,
    sheet_replacement,
    "wallet admin controls",
)

HOME.write_text(home)

css = CSS.read_text()
css += '''

.wallet-row.disabled .trade-row,
.wallet-row.disabled .strategy-row,
.wallet-row.disabled .status-row {
  opacity:.48;
}
.managed.off {
  border-color:#cfcfcf;
  color:#888;
}
.wallet-admin {
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:8px;
}
.sheet-danger {
  width:100%;
  height:42px;
  border-radius:9px;
  margin-top:12px;
  border:1px solid #b7b7b7;
  background:#fff;
  color:#555;
  font-size:9px;
  font-weight:750;
  letter-spacing:.05em;
}
.sheet-danger:disabled {
  opacity:.32;
}
.delete-note {
  margin:8px 0 0;
  color:#999;
  font-size:8px;
  line-height:1.35;
}
'''
CSS.write_text(css)

# ---------- execution engine ----------
engine = ENGINE.read_text()

engine += '''

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

      if (amount && /^\\d+$/.test(amount) && BigInt(amount) > 0n) {
        positiveTokenAccounts += 1;
      }
    }
  }

  return {
    lamports,
    positiveTokenAccounts,
  };
}
'''
ENGINE.write_text(engine)

# ---------- backend routes ----------
routes = ROUTES.read_text()

routes = replace_once(
    routes,
    '  withdrawSol,\n} from "../lib/execution-engine";\n',
    '  withdrawSol,\n  walletDeletionState,\n} from "../lib/execution-engine";\n',
    "wallet deletion import",
)

routes = replace_once(
    routes,
    '''  const wallet = await findWallet(address);
  if (!wallet || !wallet.enabled) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  if (max) {
''',
    '''  const wallet = await findWallet(address);
  if (!wallet) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  if (max) {
''',
    "allow withdrawal from disabled wallet",
)

routes = replace_once(
    routes,
    '''  const wallet = await findWallet(address);
  if (!wallet) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  const inserted = await db
''',
    '''  const wallet = await findWallet(address);
  if (!wallet) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  if (enabled && !wallet.enabled) {
    res.status(409).json({
      error: "Enable the execution wallet before enabling AUTO",
    });
    return;
  }

  const inserted = await db
''',
    "block auto on disabled wallet",
)

management_routes = '''

router.post("/execution/wallet-state", async (req, res): Promise<void> => {
  const { address, enabled } = req.body ?? {};

  if (
    typeof address !== "string" ||
    typeof enabled !== "boolean"
  ) {
    res.status(400).json({ error: "Invalid wallet state request" });
    return;
  }

  try {
    new PublicKey(address);
  } catch {
    res.status(400).json({ error: "Invalid Solana address" });
    return;
  }

  const wallet = await findWallet(address);
  if (!wallet) {
    res.status(404).json({ error: "Execution wallet not found" });
    return;
  }

  await db
    .update(executionWalletsTable)
    .set({ enabled })
    .where(eq(executionWalletsTable.id, wallet.id));

  if (!enabled) {
    await db
      .update(executionStrategiesTable)
      .set({
        enabled: false,
        state: "idle",
        updatedAt: new Date(),
      })
      .where(eq(executionStrategiesTable.walletId, wallet.id));
  }

  res.json({
    status: "success",
    address,
    enabled,
  });
});

router.delete(
  "/execution/wallets/:address",
  async (req, res): Promise<void> => {
    const address = req.params.address;
    const { confirmAddress } = req.body ?? {};

    if (
      typeof address !== "string" ||
      typeof confirmAddress !== "string" ||
      confirmAddress !== address
    ) {
      res.status(400).json({
        error: "Wallet delete confirmation does not match",
      });
      return;
    }

    try {
      new PublicKey(address);
    } catch {
      res.status(400).json({ error: "Invalid Solana address" });
      return;
    }

    const wallet = await findWallet(address);
    if (!wallet) {
      res.status(404).json({ error: "Execution wallet not found" });
      return;
    }

    if (wallet.enabled) {
      res.status(409).json({
        error: "Disable the wallet before deleting it",
      });
      return;
    }

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
        error: "Disable AUTO before deleting this wallet",
      });
      return;
    }

    const state = await walletDeletionState(address);

    if (state.positiveTokenAccounts > 0) {
      res.status(409).json({
        error:
          "Wallet still contains SPL tokens. Sell or transfer them before deleting.",
        positiveTokenAccounts: state.positiveTokenAccounts,
      });
      return;
    }

    const maxDeleteDustLamports = 10000;

    if (state.lamports > maxDeleteDustLamports) {
      res.status(409).json({
        error:
          "Wallet still contains SOL. Withdraw it before deleting.",
        balanceSol: state.lamports / 1_000_000_000,
      });
      return;
    }

    await db
      .delete(executionWalletsTable)
      .where(eq(executionWalletsTable.id, wallet.id));

    res.json({
      status: "deleted",
      address,
      abandonedDustLamports: state.lamports,
    });
  },
);
'''

routes = replace_once(
    routes,
    '\nexport default router;\n',
    management_routes + '\nexport default router;\n',
    "wallet management routes",
)

ROUTES.write_text(routes)

print("v6.5 wallet management patch applied.")
