import { connection } from "next/server";
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { monthDailyPnl } from "@/lib/queries";
import { CalendarGrid } from "@/components/calendar-grid";

function buildCells(year: number, month: number, byDay: Map<string, { pnl_sol: number; trades: number; wins: number }>) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const lastOfMonth = new Date(Date.UTC(year, month, 0));
  const startDow = firstOfMonth.getUTCDay();              // 0 = Sun
  const totalDaysInMonth = lastOfMonth.getUTCDate();
  const totalCells = Math.ceil((startDow + totalDaysInMonth) / 7) * 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - startDow);

  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    cells.push({
      day: key,
      inMonth: d.getUTCMonth() === month - 1,
      isToday: key === todayKey,
      data: byDay.get(key),
    });
  }
  return cells;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);
  const filters = parseFilters(params);

  const now = new Date();
  const year = Number(params.get("year") ?? now.getUTCFullYear());
  const month = Number(params.get("month") ?? now.getUTCMonth() + 1);

  // monthDailyPnl applies its own from/to — strip URL date filters for the calendar query so it always shows the picked month,
  // but keep strategy/mode filters.
  const monthFilters = { strategy: filters.strategy, mode: filters.mode };
  const rows = monthDailyPnl(db, monthFilters, year, month);
  const byDay = new Map(rows.map((r) => [r.day, { pnl_sol: r.pnl_sol, trades: r.trades, wins: r.wins }]));
  const cells = buildCells(year, month, byDay);

  return <CalendarGrid year={year} month={month} cells={cells} />;
}
