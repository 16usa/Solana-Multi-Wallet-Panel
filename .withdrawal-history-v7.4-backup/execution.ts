import {
  boolean,
  doublePrecision,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const executionWalletsTable = pgTable(
  "execution_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    address: text("address").notNull().unique(),
    encryptedSecret: text("encrypted_secret").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const executionStrategiesTable = pgTable(
  "execution_strategies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => executionWalletsTable.id, { onDelete: "cascade" }),
    mint: text("mint").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    tpPct: doublePrecision("tp_pct").notNull().default(100),
    tpSellPct: doublePrecision("tp_sell_pct").notNull().default(50),
    slPct: doublePrecision("sl_pct").notNull().default(30),
    slSellPct: doublePrecision("sl_sell_pct").notNull().default(100),
    entryPriceSol: doublePrecision("entry_price_sol"),
    positionCostSol: doublePrecision("position_cost_sol").notNull().default(0),
    totalInvestedSol: doublePrecision("total_invested_sol").notNull().default(0),
    realizedPnlSol: doublePrecision("realized_pnl_sol").notNull().default(0),
    tpFired: boolean("tp_fired").notNull().default(false),
    state: text("state").notNull().default("idle"),
    lastTrigger: text("last_trigger"),
    lastSignature: text("last_signature"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    walletMintUnique: uniqueIndex("execution_strategy_wallet_mint_unique").on(
      table.walletId,
      table.mint,
    ),
  }),
);

export type ExecutionWallet = typeof executionWalletsTable.$inferSelect;
export type ExecutionStrategy = typeof executionStrategiesTable.$inferSelect;
