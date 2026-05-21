"use client";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatSol } from "@/lib/format";

interface DayCell {
  day: string;          // YYYY-MM-DD
  inMonth: boolean;
  isToday: boolean;
  data?: { pnl_sol: number; trades: number; wins: number };
}

interface Props {
  year: number;
  month: number;  // 1-12
  cells: DayCell[];   // 35 or 42 cells (5 or 6 rows × 7)
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarGrid({ year, month, cells }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  function navMonth(delta: number) {
    let y = year, m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    const next = new URLSearchParams(params.toString());
    next.set("year", String(y));
    next.set("month", String(m));
    router.push(`${pathname}?${next.toString()}`);
  }

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{monthLabel}</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navMonth(-1)}>← Prev</Button>
          <Button variant="outline" size="sm" onClick={() => navMonth(1)}>Next →</Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs uppercase text-muted-foreground">
        {WEEKDAYS.map((w) => <div key={w} className="px-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => (
          <CalendarCell key={c.day} cell={c} otherParams={params.toString()} />
        ))}
      </div>
    </div>
  );
}

function CalendarCell({ cell, otherParams }: { cell: DayCell; otherParams: string }) {
  const pnl = cell.data?.pnl_sol ?? 0;
  const trades = cell.data?.trades ?? 0;
  const wins = cell.data?.wins ?? 0;
  const winRate = trades > 0 ? Math.round((wins / trades) * 100) : 0;
  const intensity = Math.min(1, Math.abs(pnl) / 1.0);  // 1 SOL = full intensity

  const bgStyle: React.CSSProperties = {};
  if (cell.inMonth && trades > 0) {
    const alpha = 0.12 + intensity * 0.38;
    bgStyle.backgroundColor = pnl > 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`;
  } else if (cell.inMonth) {
    bgStyle.backgroundColor = "rgba(120,120,120,0.05)";
  }

  const todayRing = cell.isToday ? "ring-2 ring-primary" : "";

  const content = (
    <div
      style={bgStyle}
      className={`min-h-[88px] rounded-md border p-2 text-xs ${todayRing} ${cell.inMonth ? "" : "opacity-30"}`}
    >
      <div className="font-medium">{Number(cell.day.slice(-2))}</div>
      {trades > 0 && (
        <div className="mt-1 space-y-0.5">
          <div className={pnl >= 0 ? "text-emerald-300" : "text-red-300"}>{formatSol(pnl)}</div>
          <div className="text-muted-foreground">{trades} · {winRate}% win</div>
        </div>
      )}
    </div>
  );

  if (!cell.inMonth || trades === 0) return content;

  const linkParams = new URLSearchParams(otherParams);
  linkParams.set("from", cell.day);
  linkParams.set("to", cell.day);
  linkParams.delete("lastN");
  linkParams.delete("firstN");
  // Also drop calendar-specific params from the destination link
  linkParams.delete("year");
  linkParams.delete("month");
  return <Link href={`/orders?${linkParams.toString()}`}>{content}</Link>;
}
