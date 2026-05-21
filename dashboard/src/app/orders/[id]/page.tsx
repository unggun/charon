import { connection } from "next/server";
import { db } from "@/lib/db";
import { getOrderDetail } from "@/lib/queries";
import { formatSol, formatPercent, formatMcap } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notFound } from "next/navigation";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const detail = getOrderDetail(db, id);
  if (!detail) notFound();
  const { position, trades, decision } = detail;
  const pnlColor = (position.pnl_sol ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

  let snapshot: unknown = null;
  try { snapshot = JSON.parse(position.snapshot_json); } catch { /* ignore */ }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{position.symbol ?? "—"}</h1>
        <code className="text-xs text-muted-foreground">{position.mint}</code>
        <Badge variant={position.status === "open" ? "default" : "outline"}>{position.status}</Badge>
        <Badge variant="outline">{position.strategy_id}</Badge>
        <Badge variant="outline">{position.execution_mode}</Badge>
      </div>
      <div className="text-xs text-muted-foreground">
        Opened: {new Date(position.opened_at_ms).toLocaleString()}
        {" · "}
        Closed: {position.closed_at_ms != null ? new Date(position.closed_at_ms).toLocaleString() : "—"}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">PnL</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <div>
            <div className="text-xs text-muted-foreground">Entry price</div>
            <div className="text-lg tabular-nums">{position.entry_price != null ? `$${Number(position.entry_price).toFixed(6)}` : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Exit price</div>
            <div className="text-lg tabular-nums">{position.exit_price != null ? `$${Number(position.exit_price).toFixed(6)}` : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Entry mcap</div>
            <div className="text-lg tabular-nums">{formatMcap(position.entry_mcap)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Exit mcap</div>
            <div className="text-lg tabular-nums">{formatMcap(position.exit_mcap)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Realized PnL</div>
            <div className={`text-lg tabular-nums ${pnlColor}`}>{formatSol(position.pnl_sol)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">% return</div>
            <div className={`text-lg tabular-nums ${pnlColor}`}>{formatPercent(position.pnl_percent)}</div>
          </div>
          <div className="col-span-full text-xs text-muted-foreground">
            Exit reason: <span className="text-foreground">{position.exit_reason ?? "—"}</span>
          </div>
        </CardContent>
      </Card>

      {decision && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">LLM decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Verdict: <Badge>{decision.verdict}</Badge>  Confidence: {(decision.confidence * 100).toFixed(0)}%</div>
            <div className="text-muted-foreground whitespace-pre-wrap">{decision.reason ?? "—"}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Trade log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            {trades.map((t) => (
              <div key={t.id} className="flex flex-wrap gap-3 border-b py-1 last:border-0">
                <Badge variant={t.side === "buy" ? "default" : "outline"}>{t.side}</Badge>
                <span className="text-muted-foreground">{new Date(t.at_ms).toLocaleString()}</span>
                <span>{formatMcap(t.mcap)}</span>
                {t.size_sol != null && <span>{formatSol(t.size_sol)}</span>}
                <span className="text-muted-foreground">{t.reason ?? ""}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Candidate snapshot (at decision time)</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded bg-muted/30 p-3 text-xs">{JSON.stringify(snapshot, null, 2)}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
