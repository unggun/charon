import type Database from "better-sqlite3";
import type { Filters } from "./types";

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
