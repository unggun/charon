import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { listOrders, countOrders } from "@/lib/queries";
import type { PositionRow } from "@/lib/types";

const EXPORT_CAP = 10_000;

const VALID_SORTS = new Set(["opened_at_ms", "closed_at_ms", "pnl_sol", "pnl_percent", "entry_mcap", "exit_mcap", "symbol", "peak_pct", "trough_pct"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filters = parseFilters(url.searchParams);
  const sortRaw = url.searchParams.get("sort") ?? "closed_at_ms";
  const sort = (VALID_SORTS.has(sortRaw) ? sortRaw : "closed_at_ms") as Parameters<typeof listOrders>[2]["sort"];
  const dir: "asc" | "desc" = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  const total = Math.min(countOrders(db, filters), EXPORT_CAP);
  const rows = total > 0 ? listOrders(db, filters, { page: 1, pageSize: total, sort, dir }) : [];

  const headers = [
    "opened_at_iso",
    "closed_at_iso",
    "symbol",
    "mint",
    "strategy_id",
    "execution_mode",
    "entry_price",
    "entry_mcap",
    "exit_price",
    "exit_mcap",
    "pnl_sol",
    "pnl_percent",
    "peak_pct",
    "trough_pct",
    "exit_reason",
    "size_sol",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(rowToCsv(r));

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="charon-orders-${Date.now()}.csv"`,
    },
  });
}

function rowToCsv(r: PositionRow): string {
  const cells = [
    new Date(r.opened_at_ms).toISOString(),
    r.closed_at_ms ? new Date(r.closed_at_ms).toISOString() : "",
    r.symbol ?? "",
    r.mint,
    r.strategy_id,
    r.execution_mode,
    r.entry_price ?? "",
    r.entry_mcap ?? "",
    r.exit_price ?? "",
    r.exit_mcap ?? "",
    r.pnl_sol ?? "",
    r.pnl_percent ?? "",
    r.entry_mcap && r.high_water_mcap ? (r.high_water_mcap / r.entry_mcap - 1) * 100 : "",
    r.entry_mcap && r.low_water_mcap ? (r.low_water_mcap / r.entry_mcap - 1) * 100 : "",
    r.exit_reason ?? "",
    r.size_sol,
  ];
  return cells.map((c) => csvEscape(String(c))).join(",");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
