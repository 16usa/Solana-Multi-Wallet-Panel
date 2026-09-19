import {
  boolean,
  doublePrecision,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { executionWalletsTable } from "./execution";

export const copyTradeControlTable = pgTable(
  "copy_trade_control",
  {
    id: text("id").primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const copyTradeSourcesTable = pgTable(
  "copy_trade_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    address: text("address").notNull().unique(),
    enabled: boolean("enabled").notNull().default(true),
    copyBuys: boolean("copy_buys").notNull().default(true),
    copySells: boolean("copy_sells").notNull().default(true),
    mode: text("mode").notNull().default("follow-source"),
    maxBuyAmount: doublePrecision("max_buy_amount").notNull().default(0.1),
    maxBuyCurrency: text("max_buy_currency").notNull().default("sol"),
    slippagePct: doublePrecision("slippage_pct").notNull().default(2),
    delayMs: doublePrecision("delay_ms").notNull().default(0),
    autoTpPct: doublePrecision("auto_tp_pct").notNull().default(100),
    autoTpSellPct: doublePrecision("auto_tp_sell_pct").notNull().default(50),
    autoSlPct: doublePrecision("auto_sl_pct").notNull().default(30),
    autoSlSellPct: doublePrecision("auto_sl_sell_pct").notNull().default(100),
    lastSignature: text("last_signature"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const copyTradeTargetsTable = pgTable(
  "copy_trade_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => copyTradeSourcesTable.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => executionWalletsTable.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    buyAmount: doublePrecision("buy_amount").notNull().default(0.01),
    buyCurrency: text("buy_currency").notNull().default("sol"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceWalletUnique: uniqueIndex("copy_trade_target_source_wallet_unique").on(
      table.sourceId,
      table.walletId,
    ),
  }),
);

export const copyTradeEventsTable = pgTable(
  "copy_trade_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => copyTradeSourcesTable.id, { onDelete: "cascade" }),
    sourceAddress: text("source_address").notNull(),
    sourceSignature: text("source_signature").notNull(),
    mint: text("mint").notNull(),
    side: text("side").notNull(),
    sourceSellPct: doublePrecision("source_sell_pct"),
    status: text("status").notNull().default("detected"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceSignatureUnique: uniqueIndex("copy_trade_event_source_signature_unique").on(
      table.sourceId,
      table.sourceSignature,
      table.mint,
      table.side,
    ),
  }),
);

export const copyTradeExecutionsTable = pgTable(
  "copy_trade_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => copyTradeEventsTable.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => executionWalletsTable.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    status: text("status").notNull().default("pending"),
    amountSol: doublePrecision("amount_sol"),
    sellPct: doublePrecision("sell_pct"),
    signature: text("signature"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    eventWalletUnique: uniqueIndex("copy_trade_execution_event_wallet_unique").on(
      table.eventId,
      table.walletId,
    ),
  }),
);

export type CopyTradeSource = typeof copyTradeSourcesTable.$inferSelect;
export type CopyTradeTarget = typeof copyTradeTargetsTable.$inferSelect;
export type CopyTradeEvent = typeof copyTradeEventsTable.$inferSelect;
