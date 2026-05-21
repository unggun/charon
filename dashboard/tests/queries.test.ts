import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, seedPosition } from "./fixtures";
import { overviewMetrics } from "../src/lib/queries";

let db: Database.Database;

beforeEach(() => {
  db = freshDb();
});

describe("overviewMetrics", () => {
  it("returns zeros when no closed positions", () => {
    const m = overviewMetrics(db, {});
    expect(m.totalPnlSol).toBe(0);
    expect(m.totalTrades).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.avgWinner).toBe(0);
    expect(m.avgLoser).toBe(0);
    expect(m.bestTrade).toBe(0);
    expect(m.worstTrade).toBe(0);
  });

  it("aggregates pnl across closed positions", () => {
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-02", closed: "2026-05-02", pnl_sol: -0.05 });
    seedPosition(db, { opened: "2026-05-03", closed: "2026-05-03", pnl_sol: 0.2 });

    const m = overviewMetrics(db, {});
    expect(m.totalPnlSol).toBeCloseTo(0.25, 6);
    expect(m.totalTrades).toBe(3);
    expect(m.winRate).toBeCloseTo(2 / 3, 4);
    expect(m.bestTrade).toBeCloseTo(0.2, 6);
    expect(m.worstTrade).toBeCloseTo(-0.05, 6);
  });

  it("ignores open positions", () => {
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-02", status: "open", pnl_sol: 999 });

    const m = overviewMetrics(db, {});
    expect(m.totalTrades).toBe(1);
    expect(m.totalPnlSol).toBeCloseTo(0.1, 6);
  });

  it("filters by date range (closed_at_ms)", () => {
    seedPosition(db, { opened: "2026-04-01", closed: "2026-04-01", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-15", closed: "2026-05-15", pnl_sol: 0.2 });
    seedPosition(db, { opened: "2026-06-01", closed: "2026-06-01", pnl_sol: 0.3 });

    const m = overviewMetrics(db, { from: "2026-05-01", to: "2026-05-31" });
    expect(m.totalTrades).toBe(1);
    expect(m.totalPnlSol).toBeCloseTo(0.2, 6);
  });

  it("filters by strategy", () => {
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.1, strategy: "sniper" });
    seedPosition(db, { opened: "2026-05-02", closed: "2026-05-02", pnl_sol: 0.2, strategy: "degen" });

    const m = overviewMetrics(db, { strategy: "sniper" });
    expect(m.totalTrades).toBe(1);
    expect(m.totalPnlSol).toBeCloseTo(0.1, 6);
  });

  it("filters by execution mode", () => {
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.1, mode: "dry_run" });
    seedPosition(db, { opened: "2026-05-02", closed: "2026-05-02", pnl_sol: 0.2, mode: "live" });

    const dry = overviewMetrics(db, { mode: "dry_run" });
    expect(dry.totalTrades).toBe(1);
    expect(dry.totalPnlSol).toBeCloseTo(0.1, 6);

    const both = overviewMetrics(db, { mode: "both" });
    expect(both.totalTrades).toBe(2);
  });

  it("applies lastN to most recent closes", () => {
    seedPosition(db, { opened: "2026-04-01", closed: "2026-04-01", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.2 });
    seedPosition(db, { opened: "2026-06-01", closed: "2026-06-01", pnl_sol: 0.3 });

    const m = overviewMetrics(db, { lastN: 2 });
    expect(m.totalTrades).toBe(2);
    expect(m.totalPnlSol).toBeCloseTo(0.5, 6);
  });
});
