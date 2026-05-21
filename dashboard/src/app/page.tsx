import { connection } from "next/server";
import { db } from "@/lib/db";
import { overviewMetrics, listOpenPositions, recentClosedPositions, cumulativePnlSeries } from "@/lib/queries";
import { parseFilters } from "@/lib/filters";
import { formatSol, formatPercent, truncateMint, formatRelativeTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PnlSparkline } from "@/components/pnl-sparkline";
import Link from "next/link";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);
  const filters = parseFilters(params);

  const metrics = overviewMetrics(db, filters);
  const recent = recentClosedPositions(db, filters, 5);
  const series = cumulativePnlSeries(db, filters);
  const open = listOpenPositions(db);

  const solAtRisk = open.reduce((acc, p) => acc + (p.size_sol || 0), 0);
  const peakUnrealized = open
    .map((p) => (p.entry_price && p.high_water_price ? (p.high_water_price - p.entry_price) / p.entry_price : 0))
    .reduce((acc, v) => acc + v, 0);
  const avgPeak = open.length > 0 ? (peakUnrealized / open.length) * 100 : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Realized PnL</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-5xl font-semibold tabular-nums ${metrics.totalPnlSol >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {formatSol(metrics.totalPnlSol)}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            {metrics.totalTrades} closed trades · {(metrics.winRate * 100).toFixed(1)}% win rate
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Avg winner" value={formatSol(metrics.avgWinner)} positive />
        <Stat label="Avg loser" value={formatSol(metrics.avgLoser)} negative />
        <Stat label="Best trade" value={formatSol(metrics.bestTrade)} positive />
        <Stat label="Worst trade" value={formatSol(metrics.worstTrade)} negative />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Cumulative PnL</CardTitle>
        </CardHeader>
        <CardContent>
          <PnlSparkline data={series} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Open now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-2xl font-semibold">{open.length} positions</div>
            <div className="text-sm text-muted-foreground">{formatSol(solAtRisk)} at risk</div>
            <div className="text-sm text-muted-foreground">
              Avg peak unrealized since entry: {formatPercent(avgPeak)}
              <span className="ml-1 text-xs">(peak — not current)</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Recent closes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.length === 0 && <div className="text-sm text-muted-foreground">No closed trades in range.</div>}
            {recent.map((r) => (
              <Link key={r.id} href={`/orders/${r.id}`} className="flex items-center justify-between text-sm hover:bg-muted/50 -mx-2 px-2 py-1 rounded">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{r.symbol ?? truncateMint(r.mint)}</span>
                  <Badge variant="outline" className="text-xs">{r.strategy_id}</Badge>
                </span>
                <span className="flex items-center gap-3">
                  <span className={(r.pnl_sol ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {formatSol(r.pnl_sol)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {r.closed_at_ms ? formatRelativeTime(r.closed_at_ms) : ""}
                  </span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  const color = positive ? "text-emerald-400" : negative ? "text-red-400" : "";
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
