import type Database from "better-sqlite3";
import type { Filters, PositionRow } from "./types";

interface WhereBuild {
  clauses: string[];
  params: unknown[];
}

function buildClosedWhere(f: Filters): WhereBuild {
  const clauses: string[] = ["status = 'closed'"];
  const params: unknown[] = [];

  if (f.from) {
    clauses.push("date(closed_at_ms / 1000, 'unixepoch') >= ?");
    params.push(f.from);
  }
  if (f.to) {
    clauses.push("date(closed_at_ms / 1000, 'unixepoch') <= ?");
    params.push(f.to);
  }
  if (f.strategy) {
    clauses.push("strategy_id = ?");
    params.push(f.strategy);
  }
  if (f.mode && f.mode !== "both") {
    clauses.push("execution_mode = ?");
    params.push(f.mode);
  }

  return { clauses, params };
}

function selectClosedIds(db: Database.Database, f: Filters): number[] | null {
  if (!f.lastN && !f.firstN) return null;
  const { clauses, params } = buildClosedWhere(f);
  const order = f.firstN ? "ASC" : "DESC";
  const limit = f.firstN ?? f.lastN!;
  const rows = db
    .prepare(
      `SELECT id FROM dry_run_positions WHERE ${clauses.join(" AND ")} ORDER BY closed_at_ms ${order} LIMIT ?`
    )
    .all(...params, limit) as { id: number }[];
  return rows.map((r) => r.id);
}

function whereWithLimit(db: Database.Database, f: Filters): WhereBuild {
  const ids = selectClosedIds(db, f);
  const base = buildClosedWhere(f);
  if (ids === null) return base;
  if (ids.length === 0) {
    base.clauses.push("0 = 1");
    return base;
  }
  base.clauses.push(`id IN (${ids.map(() => "?").join(",")})`);
  base.params.push(...ids);
  return base;
}

export interface OverviewMetrics {
  totalPnlSol: number;
  totalTrades: number;
  winRate: number;
  avgWinner: number;
  avgLoser: number;
  bestTrade: number;
  worstTrade: number;
}

export function overviewMetrics(db: Database.Database, f: Filters): OverviewMetrics {
  const { clauses, params } = whereWithLimit(db, f);
  const where = clauses.join(" AND ");
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(pnl_sol), 0) AS total_pnl,
         COUNT(*) AS total_trades,
         COALESCE(AVG(CASE WHEN pnl_sol > 0 THEN pnl_sol END), 0) AS avg_winner,
         COALESCE(AVG(CASE WHEN pnl_sol <= 0 THEN pnl_sol END), 0) AS avg_loser,
         COALESCE(MAX(pnl_sol), 0) AS best,
         COALESCE(MIN(pnl_sol), 0) AS worst,
         COUNT(*) FILTER (WHERE pnl_sol > 0) AS wins
       FROM dry_run_positions WHERE ${where}`
    )
    .get(...params) as {
      total_pnl: number;
      total_trades: number;
      avg_winner: number;
      avg_loser: number;
      best: number;
      worst: number;
      wins: number;
    };

  return {
    totalPnlSol: row.total_pnl,
    totalTrades: row.total_trades,
    winRate: row.total_trades > 0 ? row.wins / row.total_trades : 0,
    avgWinner: row.avg_winner,
    avgLoser: row.avg_loser,
    bestTrade: row.best,
    worstTrade: row.worst,
  };
}

const SORT_COLUMNS = new Set([
  "opened_at_ms",
  "closed_at_ms",
  "pnl_sol",
  "pnl_percent",
  "entry_mcap",
  "exit_mcap",
  "symbol",
]);

export interface OrdersListOptions {
  page: number;
  pageSize: number;
  sort: "opened_at_ms" | "closed_at_ms" | "pnl_sol" | "pnl_percent" | "entry_mcap" | "exit_mcap" | "symbol";
  dir: "asc" | "desc";
}

export function listOrders(
  db: Database.Database,
  f: Filters,
  opts: OrdersListOptions,
): PositionRow[] {
  if (!SORT_COLUMNS.has(opts.sort)) {
    throw new Error(`invalid sort column: ${opts.sort}`);
  }
  const dir = opts.dir === "asc" ? "ASC" : "DESC";
  const { clauses, params } = whereWithLimit(db, f);
  const offset = (opts.page - 1) * opts.pageSize;
  return db
    .prepare(
      `SELECT * FROM dry_run_positions WHERE ${clauses.join(" AND ")}
       ORDER BY ${opts.sort} ${dir}
       LIMIT ? OFFSET ?`
    )
    .all(...params, opts.pageSize, offset) as PositionRow[];
}

export function countOrders(db: Database.Database, f: Filters): number {
  const { clauses, params } = whereWithLimit(db, f);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM dry_run_positions WHERE ${clauses.join(" AND ")}`)
    .get(...params) as { n: number };
  return row.n;
}

export interface DailyPnlRow {
  day: string;     // YYYY-MM-DD
  pnl_sol: number;
  trades: number;
  wins: number;
}

export function dailyPnl(db: Database.Database, f: Filters): DailyPnlRow[] {
  const { clauses, params } = whereWithLimit(db, f);
  return db
    .prepare(
      `SELECT
         date(closed_at_ms / 1000, 'unixepoch') AS day,
         COALESCE(SUM(pnl_sol), 0) AS pnl_sol,
         COUNT(*) AS trades,
         COUNT(*) FILTER (WHERE pnl_sol > 0) AS wins
       FROM dry_run_positions WHERE ${clauses.join(" AND ")}
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(...params) as DailyPnlRow[];
}

export function monthDailyPnl(
  db: Database.Database,
  f: Filters,
  year: number,
  month: number,   // 1-12
): DailyPnlRow[] {
  const mm = String(month).padStart(2, "0");
  const firstDay = `${year}-${mm}-01`;
  const lastDay = lastDayOfMonth(year, month);
  return dailyPnl(db, { ...f, from: firstDay, to: lastDay });
}

function lastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return `${year}-${String(month).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
