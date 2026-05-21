import type { Filters, ExecutionMode } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(params: URLSearchParams): Filters {
  const out: Filters = {};

  const from = params.get("from");
  const to = params.get("to");
  if (from && DATE_RE.test(from)) out.from = from;
  if (to && DATE_RE.test(to)) out.to = to;

  // Date range takes precedence; only parse lastN/firstN if no date range.
  if (!out.from && !out.to) {
    const lastN = params.get("lastN");
    const firstN = params.get("firstN");
    if (lastN && /^\d+$/.test(lastN)) out.lastN = Number(lastN);
    if (firstN && /^\d+$/.test(firstN)) out.firstN = Number(firstN);
  }

  const strategy = params.get("strategy");
  if (strategy) out.strategy = strategy;

  const mode = params.get("mode");
  if (mode === "dry_run" || mode === "live" || mode === "both") {
    out.mode = mode as ExecutionMode | "both";
  }

  return out;
}

export function serializeFilters(f: Filters): string {
  const params = new URLSearchParams();
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.lastN) params.set("lastN", String(f.lastN));
  if (f.firstN) params.set("firstN", String(f.firstN));
  if (f.strategy) params.set("strategy", f.strategy);
  if (f.mode) params.set("mode", f.mode);
  return params.toString();
}
