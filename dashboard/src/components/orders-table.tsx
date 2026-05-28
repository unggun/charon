"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { PositionRow } from "@/lib/types";
import { formatSol, formatPercent, formatMcap, truncateMint, formatRelativeTime, formatDuration } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";

const COLUMNS = [
  { key: "closed_at_ms", label: "Closed" },
  { key: "symbol", label: "Symbol" },
  { key: "entry_mcap", label: "Entry mcap" },
  { key: "exit_mcap", label: "Exit mcap" },
  { key: "pnl_sol", label: "PnL" },
  { key: "pnl_percent", label: "%" },
  { key: "peak_pct", label: "Peak %" },
  { key: "trough_pct", label: "Trough %" },
] as const;

interface Props {
  rows: PositionRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
}

export function OrdersTable({ rows, total, page, pageSize, sort, dir }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function setSort(key: string) {
    const next = new URLSearchParams(params.toString());
    if (sort === key) next.set("dir", dir === "asc" ? "desc" : "asc");
    else { next.set("sort", key); next.set("dir", "desc"); }
    next.set("page", "1");
    router.push(`/orders?${next.toString()}`);
  }

  function setPage(p: number) {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    router.push(`/orders?${next.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">{total} closed positions</div>
        <Link
          href={`/orders/export?${params.toString()}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Export CSV
        </Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableHead key={c.key} onClick={() => setSort(c.key)} className="cursor-pointer select-none">
                {c.label} {sort === c.key && (dir === "asc" ? "▲" : "▼")}
              </TableHead>
            ))}
            <TableHead>Exit</TableHead>
            <TableHead>Strategy</TableHead>
            <TableHead>Duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const duration = r.closed_at_ms ? r.closed_at_ms - r.opened_at_ms : 0;
            const pnlColor = (r.pnl_sol ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";
            const peakPct = r.entry_mcap && r.high_water_mcap
              ? (r.high_water_mcap / r.entry_mcap - 1) * 100
              : null;
            const troughPct = r.entry_mcap && r.low_water_mcap
              ? (r.low_water_mcap / r.entry_mcap - 1) * 100
              : null;
            return (
              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                <TableCell className="text-muted-foreground">
                  <Link href={`/orders/${r.id}`} className="block">
                    {r.closed_at_ms ? formatRelativeTime(r.closed_at_ms) : "—"}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.id}`} className="block">
                    <div className="font-medium">{r.symbol ?? truncateMint(r.mint)}</div>
                    <div className="text-xs text-muted-foreground">{truncateMint(r.mint)}</div>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.id}`}>{formatMcap(r.entry_mcap)}</Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.id}`}>{formatMcap(r.exit_mcap)}</Link>
                </TableCell>
                <TableCell className={pnlColor}>
                  <Link href={`/orders/${r.id}`}>{formatSol(r.pnl_sol)}</Link>
                </TableCell>
                <TableCell className={pnlColor}>
                  <Link href={`/orders/${r.id}`}>{formatPercent(r.pnl_percent)}</Link>
                </TableCell>
                <TableCell className="text-emerald-400">
                  <Link href={`/orders/${r.id}`}>{formatPercent(peakPct)}</Link>
                </TableCell>
                <TableCell className="text-red-400">
                  <Link href={`/orders/${r.id}`}>{formatPercent(troughPct)}</Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.id}`}>{r.exit_reason ?? "—"}</Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.id}`}>
                    <Badge variant="outline">{r.strategy_id}</Badge>
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.id}`}>{formatDuration(duration)}</Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between text-sm">
        <div className="text-muted-foreground">Page {page} of {totalPages}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
