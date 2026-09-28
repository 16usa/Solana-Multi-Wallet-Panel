#!/usr/bin/env python3
from pathlib import Path
import shutil
import sys

ROOT = Path.cwd()
SCHEMA = ROOT / "lib/db/src/schema/execution.ts"
API = ROOT / "artifacts/api-server/src/routes/execution.ts"
UI = ROOT / "artifacts/solana-multi-wallet/src/pages/home.tsx"
CSS = ROOT / "artifacts/solana-multi-wallet/src/index.css"
BACKUP = ROOT / ".withdrawal-history-v7.4-backup"

FILES = [SCHEMA, API, UI, CSS]
missing = [str(p) for p in FILES if not p.exists()]
if missing:
    print("ERROR: run this patch from the existing Solana-Multi-Wallet-Panel workspace root.")
    print("Missing:")
    for p in missing:
        print(" -", p)
    sys.exit(1)

BACKUP.mkdir(exist_ok=True)
for p in FILES:
    dest = BACKUP / p.name
    if not dest.exists():
        shutil.copy2(p, dest)

def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"{label}: expected marker not found")
    return text.replace(old, new, 1)

# DB schema
schema = SCHEMA.read_text()
if "executionWithdrawalsTable" not in schema:
    marker = "export type ExecutionWallet = typeof executionWalletsTable.$inferSelect;"
    table = r'''export const executionWithdrawalsTable = pgTable(
  "execution_withdrawals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    amountSol: doublePrecision("amount_sol"),
    signature: text("signature"),
    status: text("status").notNull(),
    requestType: text("request_type").notNull().default("single"),
    maxRequested: boolean("max_requested").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

'''
    schema = must_replace(schema, marker, table + marker, "schema table")
    schema = must_replace(
        schema,
        "export type ExecutionStrategy = typeof executionStrategiesTable.$inferSelect;",
        "export type ExecutionStrategy = typeof executionStrategiesTable.$inferSelect;\n"
        "export type ExecutionWithdrawal = typeof executionWithdrawalsTable.$inferSelect;",
        "schema type",
    )
    SCHEMA.write_text(schema)

# API
api = API.read_text()

if 'import { and, desc, eq } from "drizzle-orm";' not in api:
    api = must_replace(
        api,
        'import { and, eq } from "drizzle-orm";',
        'import { and, desc, eq } from "drizzle-orm";',
        "drizzle import",
    )

if "executionWithdrawalsTable" not in api.split('from "@workspace/db";', 1)[0]:
    api = must_replace(
        api,
        '  executionStrategiesTable,\n  executionWalletsTable,\n} from "@workspace/db";',
        '  executionStrategiesTable,\n  executionWalletsTable,\n  executionWithdrawalsTable,\n} from "@workspace/db";',
        "db import",
    )

if 'router.get("/execution/withdrawals"' not in api:
    route_marker = 'router.post("/execution/withdraw", async (req, res): Promise<void> => {'
    route = r'''router.get("/execution/withdrawals", async (req, res): Promise<void> => {
  const address =
    typeof req.query.address === "string"
      ? req.query.address.trim()
      : "";

  if (address) {
    try {
      new PublicKey(address);
    } catch {
      res.status(400).json({ error: "Invalid Solana address" });
      return;
    }
  }

  const rawLimit = Number(req.query.limit ?? 30);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
    : 30;

  try {
    const selection = {
      id: executionWithdrawalsTable.id,
      fromAddress: executionWithdrawalsTable.fromAddress,
      toAddress: executionWithdrawalsTable.toAddress,
      amountSol: executionWithdrawalsTable.amountSol,
      signature: executionWithdrawalsTable.signature,
      status: executionWithdrawalsTable.status,
      requestType: executionWithdrawalsTable.requestType,
      maxRequested: executionWithdrawalsTable.maxRequested,
      error: executionWithdrawalsTable.error,
      createdAt: executionWithdrawalsTable.createdAt,
    };

    const history = address
      ? await db
          .select(selection)
          .from(executionWithdrawalsTable)
          .where(eq(executionWithdrawalsTable.fromAddress, address))
          .orderBy(desc(executionWithdrawalsTable.createdAt))
          .limit(limit)
      : await db
          .select(selection)
          .from(executionWithdrawalsTable)
          .orderBy(desc(executionWithdrawalsTable.createdAt))
          .limit(limit);

    res.json({ history });
  } catch (error) {
    req.log.error({ err: error }, "Withdrawal history lookup failed");
    res.status(500).json({ error: "Could not load withdrawal history" });
  }
});

'''
    api = must_replace(api, route_marker, route + route_marker, "history GET route")

if 'requestType: "single"' not in api:
    success_old = r'''    const result = await withdrawSol(
      keypair,
      to,
      max ? undefined : Number(amountSol),
      max,
    );

    res.json({'''
    success_new = r'''    const result = await withdrawSol(
      keypair,
      to,
      max ? undefined : Number(amountSol),
      max,
    );

    try {
      await db.insert(executionWithdrawalsTable).values({
        fromAddress: address,
        toAddress: to,
        amountSol: result.amountSol,
        signature: result.signature,
        status: "success",
        requestType: "single",
        maxRequested: max,
        error: null,
      });
    } catch (historyError) {
      req.log.error(
        { err: historyError, signature: result.signature },
        "Withdrawal succeeded but history write failed",
      );
    }

    res.json({'''
    api = must_replace(api, success_old, success_new, "single withdrawal success")

    catch_old = r'''  } catch (error) {
    req.log.error({ err: error }, "Managed withdrawal failed");
    res.status(422).json({
      error:
        error instanceof Error
          ? error.message
          : "Withdrawal failed",
    });
  }
});'''
    catch_new = r'''  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Withdrawal failed";

    req.log.error({ err: error }, "Managed withdrawal failed");

    try {
      const requestedAmount = Number(amountSol);

      await db.insert(executionWithdrawalsTable).values({
        fromAddress: address,
        toAddress: to,
        amountSol:
          !max && Number.isFinite(requestedAmount)
            ? requestedAmount
            : null,
        signature: null,
        status: "failed",
        requestType: "single",
        maxRequested: max,
        error: errorMessage,
      });
    } catch (historyError) {
      req.log.error(
        { err: historyError },
        "Failed withdrawal history write failed",
      );
    }

    res.status(422).json({
      error: errorMessage,
    });
  }
});'''
    api = must_replace(api, catch_old, catch_new, "single withdrawal failure")

if 'requestType: "all"' not in api:
    all_success_old = r'''      const result = await withdrawSol(
        keypair,
        to,
        undefined,
        true,
      );

      results.push({'''
    all_success_new = r'''      const result = await withdrawSol(
        keypair,
        to,
        undefined,
        true,
      );

      try {
        await db.insert(executionWithdrawalsTable).values({
          fromAddress: wallet.address,
          toAddress: to,
          amountSol: result.amountSol,
          signature: result.signature,
          status: "success",
          requestType: "all",
          maxRequested: true,
          error: null,
        });
      } catch (historyError) {
        req.log.error(
          { err: historyError, signature: result.signature },
          "Withdraw-all succeeded but history write failed",
        );
      }

      results.push({'''
    api = must_replace(api, all_success_old, all_success_new, "withdraw-all success")

    all_catch_old = r'''    } catch (error) {
      results.push({
        address: wallet.address,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }'''
    all_catch_new = r'''    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      try {
        await db.insert(executionWithdrawalsTable).values({
          fromAddress: wallet.address,
          toAddress: to,
          amountSol: null,
          signature: null,
          status: "failed",
          requestType: "all",
          maxRequested: true,
          error: errorMessage,
        });
      } catch (historyError) {
        req.log.error(
          { err: historyError },
          "Failed withdraw-all history write failed",
        );
      }

      results.push({
        address: wallet.address,
        ok: false,
        error: errorMessage,
      });
    }
  }'''
    api = must_replace(api, all_catch_old, all_catch_new, "withdraw-all failure")

API.write_text(api)

# UI
ui = UI.read_text()

if "type WithdrawalHistoryItem" not in ui:
    pnl_marker = r'''type PnlSummary = {
  totalPnlSol: number | null;
  totalPnlPct: number | null;
  realizedPnlSol: number;
  unrealizedPnlSol: number | null;
  totalInvestedSol: number;
};'''
    history_type = r'''type WithdrawalHistoryItem = {
  id: string;
  fromAddress: string;
  toAddress: string;
  amountSol: number | null;
  signature?: string | null;
  status: string;
  requestType: 'single' | 'all' | string;
  maxRequested: boolean;
  error?: string | null;
  createdAt: string;
};'''
    ui = must_replace(ui, pnl_marker, pnl_marker + "\n\n" + history_type, "history type")

if "withdrawHistoryLoading" not in ui:
    state_marker = r'''  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawMax, setWithdrawMax] = useState(false);'''
    history_state = r'''  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawalHistoryItem[]>([]);
  const [withdrawHistoryLoading, setWithdrawHistoryLoading] = useState(false);
  const [withdrawHistoryError, setWithdrawHistoryError] = useState('');'''
    ui = must_replace(ui, state_marker, state_marker + "\n" + history_state, "history state")

if "const refreshWithdrawalHistory" not in ui:
    callback_marker = r'''  }, [token]);

  const refreshCopyTrading = useCallback(async () => {'''
    callback = r'''  }, [token]);

  const refreshWithdrawalHistory = useCallback(async (address?: string) => {
    if (!unlocked || !token) return;

    setWithdrawHistoryLoading(true);
    setWithdrawHistoryError('');

    try {
      const params = new URLSearchParams({ limit: '30' });
      if (address) params.set('address', address);

      const data = await api(
        `/api/execution/withdrawals?${params.toString()}`,
      );

      setWithdrawHistory(data.history || []);
    } catch (error) {
      setWithdrawHistory([]);
      setWithdrawHistoryError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setWithdrawHistoryLoading(false);
    }
  }, [api, token, unlocked]);

  const refreshCopyTrading = useCallback(async () => {'''
    ui = must_replace(ui, callback_marker, callback, "history callback")

if "function withdrawalTimeText" not in ui:
    helper_marker = r'''  function tokenPriceText(
    solValue: number | null | undefined,
  ) {'''
    helper = r'''  function withdrawalTimeText(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';

    return date.toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

'''
    ui = must_replace(ui, helper_marker, helper + helper_marker, "history time helper")

if "void refreshWithdrawalHistory(wallet.address);" not in ui:
    wallet_open_old = r'''    setWithdrawAmount('');
    setWithdrawMax(false);
    setNotice('');
  }

  function openGlobalFunds() {'''
    wallet_open_new = r'''    setWithdrawAmount('');
    setWithdrawMax(false);
    setWithdrawHistory([]);
    setWithdrawHistoryError('');
    setNotice('');
    void refreshWithdrawalHistory(wallet.address);
  }

  function openGlobalFunds() {'''
    ui = must_replace(ui, wallet_open_old, wallet_open_new, "wallet history load")

if "void refreshWithdrawalHistory();" not in ui:
    global_open_old = r'''    setWithdrawAmount('');
    setWithdrawMax(false);
    setNotice('');
  }

  function closeFunds() {'''
    global_open_new = r'''    setWithdrawAmount('');
    setWithdrawMax(false);
    setWithdrawHistory([]);
    setWithdrawHistoryError('');
    setNotice('');
    void refreshWithdrawalHistory();
  }

  function closeFunds() {'''
    ui = must_replace(ui, global_open_old, global_open_new, "global history load")

close_old = r'''    setFundsOpen(false);
    setWithdrawAmount('');
    setWithdrawMax(false);
  }'''
close_new = r'''    setFundsOpen(false);
    setWithdrawAmount('');
    setWithdrawMax(false);
    setWithdrawHistory([]);
    setWithdrawHistoryError('');
  }'''
if close_old in ui:
    ui = ui.replace(close_old, close_new, 1)

single_success_old = r'''      setNotice(
        `Withdrawal confirmed · ${moneyText(data.amountSol)} · ${data.signature}`,
      );
      closeFunds();
      await refresh();'''
single_success_new = r'''      setNotice(
        `Withdrawal confirmed · ${moneyText(data.amountSol)} · ${data.signature}`,
      );
      setWithdrawAmount('');
      setWithdrawMax(false);
      await refresh();
      await refreshWithdrawalHistory(wallet.address);'''
if single_success_old in ui:
    ui = ui.replace(single_success_old, single_success_new, 1)

single_fail_old = r'''    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  }

  async function withdrawAllWallets() {'''
single_fail_new = r'''    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      void refreshWithdrawalHistory(wallet.address);
    } finally {
      setBusy('');
    }
  }

  async function withdrawAllWallets() {'''
if single_fail_old in ui:
    ui = ui.replace(single_fail_old, single_fail_new, 1)

all_success_old = r'''      setNotice(`Withdraw all finished · ${ok} success · ${failed} failed`);
      closeFunds();
      await refresh();'''
all_success_new = r'''      setNotice(`Withdraw all finished · ${ok} success · ${failed} failed`);
      await refresh();
      await refreshWithdrawalHistory();'''
if all_success_old in ui:
    ui = ui.replace(all_success_old, all_success_new, 1)

if 'className="withdraw-history"' not in ui:
    render_marker = r'''              <p className="sheet-footnote">
                MAX leaves a small SOL reserve for the network fee. Disable
                AUTO before draining a wallet.
              </p>'''
    render = r'''
              <div className="withdraw-history">
                <div className="withdraw-history-head">
                  <strong>WITHDRAWAL HISTORY</strong>
                  <span>
                    {menuWallet ? short(menuWallet.address) : 'ALL WALLETS'}
                  </span>
                </div>

                {withdrawHistoryLoading && (
                  <div className="withdraw-history-empty">LOADING…</div>
                )}

                {!withdrawHistoryLoading && withdrawHistoryError && (
                  <div className="withdraw-history-error">
                    {withdrawHistoryError}
                  </div>
                )}

                {!withdrawHistoryLoading &&
                  !withdrawHistoryError &&
                  withdrawHistory.length === 0 && (
                    <div className="withdraw-history-empty">
                      No recorded withdrawals yet.
                    </div>
                  )}

                {!withdrawHistoryLoading &&
                  !withdrawHistoryError &&
                  withdrawHistory.map((item) => (
                    <div className="withdraw-history-row" key={item.id}>
                      <div className="withdraw-history-top">
                        <strong>
                          {item.amountSol == null
                            ? '—'
                            : `${numberText(item.amountSol, 6)} SOL`}
                          {item.maxRequested ? ' · MAX' : ''}
                        </strong>
                        <b
                          className={
                            item.status === 'success'
                              ? 'success'
                              : 'failed'
                          }
                        >
                          {item.status.toUpperCase()}
                        </b>
                      </div>

                      <div
                        className="withdraw-history-route"
                        title={`${item.fromAddress} → ${item.toAddress}`}
                      >
                        <span>
                          FROM {short(item.fromAddress)} → TO{' '}
                          {short(item.toAddress)}
                        </span>
                        <time>{withdrawalTimeText(item.createdAt)}</time>
                      </div>

                      <div className="withdraw-history-meta">
                        <span>
                          {item.requestType === 'all'
                            ? 'WITHDRAW ALL'
                            : 'WITHDRAW'}
                        </span>

                        {item.signature && (
                          <button
                            onClick={() =>
                              window.open(
                                `https://solscan.io/tx/${item.signature}`,
                                '_blank',
                                'noopener,noreferrer',
                              )
                            }
                            title={item.signature}
                          >
                            TX {short(item.signature)} ↗
                          </button>
                        )}
                      </div>

                      {item.error && (
                        <div className="withdraw-history-row-error">
                          {item.error}
                        </div>
                      )}
                    </div>
                  ))}
              </div>'''
    ui = must_replace(ui, render_marker, render_marker + "\n" + render, "history render")

UI.write_text(ui)

# CSS
css = CSS.read_text()
if ".withdraw-history-head" not in css:
    css += r'''

/* v7.4 persistent withdrawal history */
.funds-sheet {
  max-height:88vh;
  overflow-y:auto;
}

.withdraw-history {
  margin-top:14px;
  padding-top:12px;
  border-top:1px solid #ededed;
}

.withdraw-history-head {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding-bottom:5px;
}

.withdraw-history-head strong {
  font-size:8px;
  font-weight:800;
  letter-spacing:.05em;
}

.withdraw-history-head span {
  color:#888;
  font-size:7px;
}

.withdraw-history-empty,
.withdraw-history-error {
  padding:11px 0 2px;
  color:#999;
  font-size:8px;
}

.withdraw-history-error {
  color:#7b2d2d;
}

.withdraw-history-row {
  padding:9px 0;
  border-top:1px solid #ededed;
}

.withdraw-history-top,
.withdraw-history-route,
.withdraw-history-meta {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:9px;
}

.withdraw-history-top strong {
  font-size:9px;
  font-weight:750;
}

.withdraw-history-top b {
  font-size:7px;
  font-weight:800;
  white-space:nowrap;
}

.withdraw-history-top b.failed {
  color:#7b2d2d;
}

.withdraw-history-route {
  margin-top:4px;
  color:#777;
  font-size:7px;
}

.withdraw-history-route span {
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.withdraw-history-route time {
  flex:0 0 auto;
  white-space:nowrap;
}

.withdraw-history-meta {
  margin-top:4px;
  color:#999;
  font-size:6.5px;
}

.withdraw-history-meta button {
  border:0;
  background:transparent;
  color:#111;
  padding:0;
  font-size:6.5px;
  font-weight:750;
}

.withdraw-history-row-error {
  margin-top:5px;
  color:#7b2d2d;
  font-size:7px;
  line-height:1.35;
  word-break:break-word;
}

html[data-theme='dark'] .withdraw-history,
html[data-theme='dark'] .withdraw-history-row {
  border-color:#262626;
}

html[data-theme='dark'] .withdraw-history-head span,
html[data-theme='dark'] .withdraw-history-route,
html[data-theme='dark'] .withdraw-history-meta,
html[data-theme='dark'] .withdraw-history-empty {
  color:#8d8d8d;
}

html[data-theme='dark'] .withdraw-history-meta button {
  color:#fff;
}

html[data-theme='dark'] .withdraw-history-error,
html[data-theme='dark'] .withdraw-history-top b.failed,
html[data-theme='dark'] .withdraw-history-row-error {
  color:#d28b8b;
}
'''
    CSS.write_text(css)

checks = {
    "schema": "executionWithdrawalsTable" in SCHEMA.read_text(),
    "api-get": 'router.get("/execution/withdrawals"' in API.read_text(),
    "api-single": 'requestType: "single"' in API.read_text(),
    "api-all": 'requestType: "all"' in API.read_text(),
    "ui-fetch": "refreshWithdrawalHistory" in UI.read_text(),
    "ui-render": 'className="withdraw-history"' in UI.read_text(),
    "css": ".withdraw-history-head" in CSS.read_text(),
}
bad = [k for k, v in checks.items() if not v]
if bad:
    raise RuntimeError("Patch verification failed: " + ", ".join(bad))

print("Withdrawal History v7.4 applied successfully.")
print("No server restart was performed.")
print("Backup:", BACKUP)
