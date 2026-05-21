"use client";
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis } from "recharts";

export function PnlSparkline({ data }: { data: { closed_at_ms: number; cumulative: number }[] }) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground">No closed trades in range.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="closed_at_ms" hide />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
          labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
          formatter={(v) => [`${Number(v).toFixed(4)} SOL`, "Cumulative"]}
        />
        <Line type="monotone" dataKey="cumulative" stroke="hsl(142 76% 50%)" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
