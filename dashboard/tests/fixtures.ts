import Database from "better-sqlite3";

export function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dry_run_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      mint TEXT NOT NULL,
      symbol TEXT,
      status TEXT NOT NULL,
      opened_at_ms INTEGER NOT NULL,
      closed_at_ms INTEGER,
      size_sol REAL NOT NULL,
      entry_price REAL,
      entry_mcap REAL,
      token_amount_est REAL,
      high_water_price REAL,
      high_water_mcap REAL,
      low_water_price REAL,
      low_water_mcap REAL,
      tp_percent REAL NOT NULL,
      sl_percent REAL NOT NULL,
      trailing_enabled INTEGER NOT NULL,
      trailing_percent REAL NOT NULL,
      trailing_armed INTEGER NOT NULL DEFAULT 0,
      exit_price REAL,
      exit_mcap REAL,
      exit_reason TEXT,
      pnl_percent REAL,
      pnl_sol REAL,
      llm_decision_id INTEGER,
      execution_mode TEXT DEFAULT 'dry_run',
      entry_signature TEXT,
      exit_signature TEXT,
      token_amount_raw TEXT,
      snapshot_json TEXT NOT NULL,
      strategy_id TEXT DEFAULT 'sniper',
      partial_tp_done INTEGER DEFAULT 0
    );
    CREATE TABLE dry_run_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      price REAL,
      mcap REAL,
      size_sol REAL,
      token_amount_est REAL,
      reason TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE llm_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT,
      risks_json TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
  `);
  return db;
}

interface SeedPosition {
  symbol?: string;
  opened: string;   // ISO date e.g. "2026-05-10"
  closed?: string;
  pnl_sol?: number;
  size_sol?: number;
  status?: "open" | "closed";
  mode?: "dry_run" | "live";
  strategy?: string;
  entry_price?: number;
  high_water_price?: number;
}

let mintCounter = 0;
function mkMint() {
  mintCounter += 1;
  return `Mint${String(mintCounter).padStart(40, "0")}`;
}

export function seedPosition(db: Database.Database, p: SeedPosition) {
  const openedMs = Date.parse(`${p.opened}T12:00:00Z`);
  const closedMs = p.closed ? Date.parse(`${p.closed}T12:00:00Z`) : null;
  return db
    .prepare(
      `INSERT INTO dry_run_positions (
        mint, symbol, status, opened_at_ms, closed_at_ms,
        size_sol, entry_price, high_water_price,
        tp_percent, sl_percent, trailing_enabled, trailing_percent,
        pnl_sol, pnl_percent, execution_mode, strategy_id, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, -25, 1, 20, ?, ?, ?, ?, '{}')`
    )
    .run(
      mkMint(),
      p.symbol ?? "TKN",
      p.status ?? "closed",
      openedMs,
      closedMs,
      p.size_sol ?? 0.1,
      p.entry_price ?? 0.0001,
      p.high_water_price ?? p.entry_price ?? 0.0001,
      p.pnl_sol ?? 0,
      p.pnl_sol != null && p.size_sol ? (p.pnl_sol / p.size_sol) * 100 : 0,
      p.mode ?? "dry_run",
      p.strategy ?? "sniper",
    ).lastInsertRowid as number;
}
