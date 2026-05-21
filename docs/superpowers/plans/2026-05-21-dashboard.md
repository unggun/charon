# Charon Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a private Next.js dashboard that surfaces Charon's realized PnL, daily activity, and per-order detail, exposed via Cloudflare Tunnel + Zero Trust Access.

**Architecture:** Next.js 15 App Router co-located at `/opt/charon/dashboard/`. Server components query Charon's SQLite directly in read-only mode — no API layer. Production runs on `127.0.0.1:3000` and is reverse-proxied to a public hostname by `cloudflared`. Access is gated to a single email by Cloudflare Zero Trust.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui, better-sqlite3 (readonly), Recharts, vitest.

---

## File Structure

```
/opt/charon/dashboard/
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── components.json                 ← shadcn config
├── vitest.config.ts
├── app/
│   ├── layout.tsx                  ← nav + filter bar shell
│   ├── globals.css                 ← Tailwind v4 import + theme
│   ├── page.tsx                    ← Overview
│   ├── calendar/page.tsx
│   ├── orders/
│   │   ├── page.tsx                ← Orders list
│   │   ├── [id]/page.tsx           ← Order detail
│   │   └── export/route.ts         ← CSV export endpoint
├── components/
│   ├── nav.tsx
│   ├── filter-bar.tsx
│   ├── calendar-grid.tsx
│   ├── pnl-sparkline.tsx
│   ├── orders-table.tsx
│   └── ui/                         ← shadcn-installed primitives
├── lib/
│   ├── db.ts                       ← better-sqlite3 readonly handle
│   ├── types.ts                    ← row + filter types
│   ├── filters.ts                  ← URL filter parsing/serialization
│   ├── format.ts                   ← SOL / % / time formatters
│   └── queries.ts                  ← typed query functions
├── tests/
│   ├── fixtures.ts                 ← seed in-memory SQLite
│   ├── filters.test.ts
│   ├── format.test.ts
│   └── queries.test.ts
└── README.md                       ← run/deploy notes
```

Deploy artifacts (created in tasks 17-19):
- `/etc/systemd/system/charon-dashboard.service`
- `/etc/cloudflared/config.yml` and `/etc/systemd/system/cloudflared.service`

---

## Task 1: Scaffold Next.js 15 + Tailwind v4

**Files:**
- Create: `dashboard/` directory and all scaffolded files

- [ ] **Step 1: Create the subdirectory and scaffold Next.js**

Run from `/opt/charon`:
```bash
npx --yes create-next-app@latest dashboard \
  --typescript --tailwind --eslint --app \
  --src-dir false --turbopack \
  --import-alias "@/*" \
  --no-git --use-npm
```

When prompted about Turbopack, accept defaults. This creates `dashboard/` with Next.js 15, React 19, Tailwind v4, TypeScript.

- [ ] **Step 2: Verify scaffold by running dev server**

```bash
cd /opt/charon/dashboard
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Expected: dev server logs `Ready in <Xs>` and exposes only `127.0.0.1:3000`. Ctrl-C to stop.

- [ ] **Step 3: Add `dashboard/node_modules` to root .gitignore if not already**

Check `/opt/charon/.gitignore`. If `dashboard/node_modules` is not covered (it should be via a generic `node_modules` rule), add:
```
dashboard/node_modules
dashboard/.next
```

- [ ] **Step 4: Commit**

```bash
cd /opt/charon
git add dashboard/ .gitignore
git commit -m "feat(dashboard): scaffold Next.js 15 + Tailwind v4 in dashboard/"
```

---

## Task 2: Install shadcn/ui + core primitives

**Files:**
- Create: `dashboard/components.json`, `dashboard/components/ui/*`

- [ ] **Step 1: Initialize shadcn**

Run from `/opt/charon/dashboard`:
```bash
npx shadcn@latest init -d
```

Accept defaults (style: default, base color: slate, css variables: yes). This creates `components.json` and `components/ui/`.

- [ ] **Step 2: Install the primitives we need**

```bash
npx shadcn@latest add button card table tabs badge dropdown-menu input popover calendar separator skeleton sonner
```

`calendar` here is shadcn's date-picker primitive — we'll use it inside the FilterBar's date range picker, not for the month-grid view.

- [ ] **Step 3: Verify build still works**

```bash
npm run build
```

Expected: build completes without errors. Warnings about no pages using server actions are fine.

- [ ] **Step 4: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): add shadcn/ui primitives"
```

---

## Task 3: Read-only SQLite handle + smoke test

**Files:**
- Create: `dashboard/lib/db.ts`
- Modify: `dashboard/next.config.ts`
- Modify: `dashboard/package.json`

- [ ] **Step 1: Install better-sqlite3**

```bash
cd /opt/charon/dashboard
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Add better-sqlite3 to external packages so Next.js doesn't bundle it**

Replace `dashboard/next.config.ts` contents with:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 3: Write the readonly DB handle**

Create `dashboard/lib/db.ts`:
```ts
import Database from "better-sqlite3";
import path from "node:path";

declare global {
  // eslint-disable-next-line no-var
  var __charonDb: Database.Database | undefined;
}

function open() {
  const dbPath = process.env.CHARON_DB_PATH
    ?? path.resolve(process.cwd(), "..", "charon.sqlite");
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

export const db: Database.Database =
  global.__charonDb ?? (global.__charonDb = open());
```

The global cache prevents Next.js hot-reload from leaking file handles in dev.

- [ ] **Step 4: Write a smoke-test script and run it**

Create `dashboard/scripts/db-smoke.ts`:
```ts
import { db } from "../lib/db";

const row = db
  .prepare(
    "SELECT COUNT(*) AS n, SUM(pnl_sol) AS pnl FROM dry_run_positions WHERE status = 'closed'"
  )
  .get() as { n: number; pnl: number | null };

console.log(`closed positions: ${row.n}, total realized PnL: ${row.pnl?.toFixed(4)} SOL`);
```

Run:
```bash
npx tsx scripts/db-smoke.ts
```

If `tsx` isn't available globally, install it first: `npm install --save-dev tsx`.

Expected output (numbers will match current DB state): `closed positions: 310, total realized PnL: <some number> SOL`

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): add readonly SQLite handle + smoke test"
```

---

## Task 4: Types + test fixture helper

**Files:**
- Create: `dashboard/lib/types.ts`
- Create: `dashboard/tests/fixtures.ts`
- Create: `dashboard/vitest.config.ts`
- Modify: `dashboard/package.json` (add `test` script)

- [ ] **Step 1: Install vitest**

```bash
cd /opt/charon/dashboard
npm install --save-dev vitest
```

- [ ] **Step 2: Add test script to package.json**

In `dashboard/package.json`, in the `scripts` block, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest config**

Create `dashboard/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Define row + filter types**

Create `dashboard/lib/types.ts`:
```ts
export type ExecutionMode = "dry_run" | "live";
export type PositionStatus = "open" | "closed";

export interface PositionRow {
  id: number;
  candidate_id: number | null;
  mint: string;
  symbol: string | null;
  status: PositionStatus;
  opened_at_ms: number;
  closed_at_ms: number | null;
  size_sol: number;
  entry_price: number | null;
  entry_mcap: number | null;
  high_water_price: number | null;
  high_water_mcap: number | null;
  exit_price: number | null;
  exit_mcap: number | null;
  exit_reason: string | null;
  pnl_percent: number | null;
  pnl_sol: number | null;
  execution_mode: ExecutionMode;
  strategy_id: string;
  snapshot_json: string;
  llm_decision_id: number | null;
}

export interface TradeRow {
  id: number;
  position_id: number;
  mint: string;
  side: "buy" | "sell";
  at_ms: number;
  price: number | null;
  mcap: number | null;
  size_sol: number | null;
  token_amount_est: number | null;
  reason: string | null;
  payload_json: string;
}

export interface LlmDecisionRow {
  id: number;
  candidate_id: number;
  mint: string;
  created_at_ms: number;
  verdict: string;
  confidence: number;
  reason: string | null;
  risks_json: string;
  raw_json: string;
}

export interface Filters {
  from?: string;        // YYYY-MM-DD inclusive
  to?: string;          // YYYY-MM-DD inclusive
  lastN?: number;
  firstN?: number;
  strategy?: string;
  mode?: ExecutionMode | "both";
}
```

- [ ] **Step 5: Create the test fixture helper**

Create `dashboard/tests/fixtures.ts`:
```ts
import Database from "better-sqlite3";

export function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dry_run_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER,
      mint TEXT NOT NULL,
      symbol TEXT,
      status TEXT NOT NULL,
      opened_at_ms INTEGER NOT NULL,
      closed_at_ms INTEGER,
      size_sol REAL NOT NULL,
      entry_price REAL,
      entry_mcap REAL,
      token_amount_est REAL,
      high_water_price REAL,
      high_water_mcap REAL,
      tp_percent REAL NOT NULL,
      sl_percent REAL NOT NULL,
      trailing_enabled INTEGER NOT NULL,
      trailing_percent REAL NOT NULL,
      trailing_armed INTEGER NOT NULL DEFAULT 0,
      exit_price REAL,
      exit_mcap REAL,
      exit_reason TEXT,
      pnl_percent REAL,
      pnl_sol REAL,
      llm_decision_id INTEGER,
      execution_mode TEXT DEFAULT 'dry_run',
      entry_signature TEXT,
      exit_signature TEXT,
      token_amount_raw TEXT,
      snapshot_json TEXT NOT NULL,
      strategy_id TEXT DEFAULT 'sniper',
      partial_tp_done INTEGER DEFAULT 0
    );
    CREATE TABLE dry_run_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      price REAL,
      mcap REAL,
      size_sol REAL,
      token_amount_est REAL,
      reason TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE llm_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER NOT NULL,
      mint TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      confidence REAL NOT NULL,
      reason TEXT,
      risks_json TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
  `);
  return db;
}

interface SeedPosition {
  symbol?: string;
  opened: string;   // ISO date e.g. "2026-05-10"
  closed?: string;
  pnl_sol?: number;
  size_sol?: number;
  status?: "open" | "closed";
  mode?: "dry_run" | "live";
  strategy?: string;
  entry_price?: number;
  high_water_price?: number;
}

let mintCounter = 0;
function mkMint() {
  mintCounter += 1;
  return `Mint${String(mintCounter).padStart(40, "0")}`;
}

export function seedPosition(db: Database.Database, p: SeedPosition) {
  const openedMs = Date.parse(`${p.opened}T12:00:00Z`);
  const closedMs = p.closed ? Date.parse(`${p.closed}T12:00:00Z`) : null;
  return db
    .prepare(
      `INSERT INTO dry_run_positions (
        mint, symbol, status, opened_at_ms, closed_at_ms,
        size_sol, entry_price, high_water_price,
        tp_percent, sl_percent, trailing_enabled, trailing_percent,
        pnl_sol, pnl_percent, execution_mode, strategy_id, snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, -25, 1, 20, ?, ?, ?, ?, '{}')`
    )
    .run(
      mkMint(),
      p.symbol ?? "TKN",
      p.status ?? "closed",
      openedMs,
      closedMs,
      p.size_sol ?? 0.1,
      p.entry_price ?? 0.0001,
      p.high_water_price ?? p.entry_price ?? 0.0001,
      p.pnl_sol ?? 0,
      p.pnl_sol != null && p.size_sol ? (p.pnl_sol / p.size_sol) * 100 : 0,
      p.mode ?? "dry_run",
      p.strategy ?? "sniper",
    ).lastInsertRowid as number;
}
```

- [ ] **Step 6: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): types, vitest config, and test fixture helper"
```

---

## Task 5: URL filter parsing/serialization (TDD)

**Files:**
- Create: `dashboard/tests/filters.test.ts` (first)
- Create: `dashboard/lib/filters.ts`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/tests/filters.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseFilters, serializeFilters } from "../lib/filters";

describe("parseFilters", () => {
  it("returns empty object when no params", () => {
    expect(parseFilters(new URLSearchParams())).toEqual({});
  });

  it("parses date range", () => {
    const params = new URLSearchParams("from=2026-01-01&to=2026-01-31");
    expect(parseFilters(params)).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("rejects invalid date format", () => {
    expect(parseFilters(new URLSearchParams("from=2026/01/01"))).toEqual({});
  });

  it("parses lastN as integer", () => {
    expect(parseFilters(new URLSearchParams("lastN=50"))).toEqual({ lastN: 50 });
  });

  it("ignores non-numeric lastN", () => {
    expect(parseFilters(new URLSearchParams("lastN=abc"))).toEqual({});
  });

  it("date range takes precedence over lastN if both present", () => {
    const params = new URLSearchParams("from=2026-01-01&to=2026-01-31&lastN=50");
    const result = parseFilters(params);
    expect(result.from).toBe("2026-01-01");
    expect(result.lastN).toBeUndefined();
  });

  it("parses strategy and mode", () => {
    const params = new URLSearchParams("strategy=sniper&mode=dry_run");
    expect(parseFilters(params)).toMatchObject({
      strategy: "sniper",
      mode: "dry_run",
    });
  });

  it("defaults invalid mode to omitted", () => {
    expect(parseFilters(new URLSearchParams("mode=garbage"))).toEqual({});
  });
});

describe("serializeFilters", () => {
  it("returns empty string when no filters", () => {
    expect(serializeFilters({})).toBe("");
  });

  it("omits undefined values", () => {
    expect(serializeFilters({ from: "2026-01-01", to: undefined })).toBe("from=2026-01-01");
  });

  it("serializes all filter keys", () => {
    const s = serializeFilters({
      from: "2026-01-01",
      to: "2026-01-31",
      strategy: "sniper",
      mode: "dry_run",
    });
    const parsed = Object.fromEntries(new URLSearchParams(s));
    expect(parsed).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      strategy: "sniper",
      mode: "dry_run",
    });
  });
});
```

- [ ] **Step 2: Run tests — they should fail**

```bash
cd /opt/charon/dashboard
npm test
```

Expected: tests fail with "cannot resolve module ../lib/filters".

- [ ] **Step 3: Implement filters.ts**

Create `dashboard/lib/filters.ts`:
```ts
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
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npm test
```

Expected: all `filters.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): URL filter parsing and serialization"
```

---

## Task 6: Format helpers (TDD)

**Files:**
- Create: `dashboard/tests/format.test.ts`
- Create: `dashboard/lib/format.ts`

- [ ] **Step 1: Write failing tests**

Create `dashboard/tests/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatSol, formatPercent, formatMcap, truncateMint, formatRelativeTime, formatDuration } from "../lib/format";

describe("formatSol", () => {
  it("formats positive with + sign and 4 decimals", () => {
    expect(formatSol(0.1234)).toBe("+0.1234 SOL");
  });
  it("formats negative with - sign", () => {
    expect(formatSol(-0.5)).toBe("-0.5000 SOL");
  });
  it("formats zero without sign", () => {
    expect(formatSol(0)).toBe("0.0000 SOL");
  });
  it("formats null as em dash", () => {
    expect(formatSol(null)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("formats with + and 2 decimals", () => {
    expect(formatPercent(12.345)).toBe("+12.35%");
  });
  it("formats negative", () => {
    expect(formatPercent(-3.5)).toBe("-3.50%");
  });
  it("handles null", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("formatMcap", () => {
  it("uses K for thousands", () => {
    expect(formatMcap(12_500)).toBe("$12.5K");
  });
  it("uses M for millions", () => {
    expect(formatMcap(2_400_000)).toBe("$2.4M");
  });
  it("uses plain dollars under 1k", () => {
    expect(formatMcap(850)).toBe("$850");
  });
  it("handles null", () => {
    expect(formatMcap(null)).toBe("—");
  });
});

describe("truncateMint", () => {
  it("shows first 4 and last 4 with ellipsis", () => {
    expect(truncateMint("ABCDEFGHIJKLMNOPQRSTUVWXYZ")).toBe("ABCD…WXYZ");
  });
});

describe("formatRelativeTime", () => {
  it("formats seconds", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe("30s ago");
  });
  it("formats minutes", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  });
  it("formats hours", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
  it("formats days", () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});

describe("formatDuration", () => {
  it("formats short durations in minutes", () => {
    expect(formatDuration(5 * 60_000)).toBe("5m");
  });
  it("formats hours+minutes", () => {
    expect(formatDuration(2 * 3_600_000 + 30 * 60_000)).toBe("2h 30m");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: format.test.ts fails (module not found).

- [ ] **Step 3: Implement format.ts**

Create `dashboard/lib/format.ts`:
```ts
export function formatSol(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(4)} SOL`;
}

export function formatPercent(v: number | null | undefined): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

export function formatMcap(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

export function truncateMint(mint: string): string {
  if (mint.length <= 8) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm test
```

Expected: all format tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): formatting helpers"
```

---

## Task 7: Query — overview metrics (TDD)

**Files:**
- Modify: `dashboard/tests/queries.test.ts`
- Create: `dashboard/lib/queries.ts`

- [ ] **Step 1: Write failing tests**

Create `dashboard/tests/queries.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { freshDb, seedPosition } from "./fixtures";
import { overviewMetrics } from "../lib/queries";

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
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
npm test
```

Expected: queries.test.ts fails — `overviewMetrics` not exported.

- [ ] **Step 3: Implement queries.ts skeleton with overviewMetrics**

Create `dashboard/lib/queries.ts`:
```ts
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
    .prepare(`SELECT id FROM dry_run_positions WHERE ${clauses.join(" AND ")} ORDER BY closed_at_ms ${order} LIMIT ?`)
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
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm test
```

Expected: all overviewMetrics tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): overview metrics query"
```

---

## Task 8: Query — orders list (TDD)

**Files:**
- Modify: `dashboard/tests/queries.test.ts` (append)
- Modify: `dashboard/lib/queries.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `dashboard/tests/queries.test.ts`:
```ts
import { listOrders, countOrders } from "../lib/queries";

describe("listOrders", () => {
  it("returns paginated closed positions, newest first", () => {
    for (let d = 1; d <= 5; d++) {
      seedPosition(db, { opened: `2026-05-0${d}`, closed: `2026-05-0${d}`, pnl_sol: d * 0.1 });
    }
    const page1 = listOrders(db, {}, { page: 1, pageSize: 3, sort: "closed_at_ms", dir: "desc" });
    expect(page1).toHaveLength(3);
    expect(page1[0].pnl_sol).toBeCloseTo(0.5, 6);

    const page2 = listOrders(db, {}, { page: 2, pageSize: 3, sort: "closed_at_ms", dir: "desc" });
    expect(page2).toHaveLength(2);
  });

  it("supports sort by pnl_sol asc", () => {
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-02", closed: "2026-05-02", pnl_sol: -0.3 });
    seedPosition(db, { opened: "2026-05-03", closed: "2026-05-03", pnl_sol: 0.2 });

    const rows = listOrders(db, {}, { page: 1, pageSize: 10, sort: "pnl_sol", dir: "asc" });
    expect(rows.map((r) => r.pnl_sol)).toEqual([-0.3, 0.1, 0.2]);
  });

  it("rejects invalid sort column", () => {
    expect(() => listOrders(db, {}, { page: 1, pageSize: 10, sort: "drop_table" as never, dir: "asc" })).toThrow();
  });
});

describe("countOrders", () => {
  it("counts closed positions matching filters", () => {
    seedPosition(db, { opened: "2026-04-01", closed: "2026-04-01", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-15", closed: "2026-05-15", pnl_sol: 0.2 });
    expect(countOrders(db, {})).toBe(2);
    expect(countOrders(db, { from: "2026-05-01", to: "2026-05-31" })).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test
```

Expected: listOrders / countOrders not exported.

- [ ] **Step 3: Append to queries.ts**

Append to `dashboard/lib/queries.ts`:
```ts
import type { PositionRow } from "./types";

const SORT_COLUMNS = new Set([
  "opened_at_ms",
  "closed_at_ms",
  "pnl_sol",
  "pnl_percent",
  "entry_mcap",
  "exit_mcap",
  "symbol",
]);

export interface OrdersListOptions {
  page: number;
  pageSize: number;
  sort: "opened_at_ms" | "closed_at_ms" | "pnl_sol" | "pnl_percent" | "entry_mcap" | "exit_mcap" | "symbol";
  dir: "asc" | "desc";
}

export function listOrders(
  db: Database.Database,
  f: Filters,
  opts: OrdersListOptions,
): PositionRow[] {
  if (!SORT_COLUMNS.has(opts.sort)) {
    throw new Error(`invalid sort column: ${opts.sort}`);
  }
  const dir = opts.dir === "asc" ? "ASC" : "DESC";
  const { clauses, params } = whereWithLimit(db, f);
  const offset = (opts.page - 1) * opts.pageSize;
  return db
    .prepare(
      `SELECT * FROM dry_run_positions WHERE ${clauses.join(" AND ")}
       ORDER BY ${opts.sort} ${dir}
       LIMIT ? OFFSET ?`
    )
    .all(...params, opts.pageSize, offset) as PositionRow[];
}

export function countOrders(db: Database.Database, f: Filters): number {
  const { clauses, params } = whereWithLimit(db, f);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM dry_run_positions WHERE ${clauses.join(" AND ")}`)
    .get(...params) as { n: number };
  return row.n;
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm test
```

Expected: all listOrders / countOrders tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): orders list query with pagination and sort"
```

---

## Task 9: Query — calendar daily aggregation (TDD)

**Files:**
- Modify: `dashboard/tests/queries.test.ts` (append)
- Modify: `dashboard/lib/queries.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `dashboard/tests/queries.test.ts`:
```ts
import { dailyPnl, monthDailyPnl } from "../lib/queries";

describe("dailyPnl", () => {
  it("groups by closed-at day", () => {
    seedPosition(db, { opened: "2026-05-10", closed: "2026-05-10", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-10", closed: "2026-05-10", pnl_sol: 0.2 });
    seedPosition(db, { opened: "2026-05-11", closed: "2026-05-11", pnl_sol: -0.05 });

    const rows = dailyPnl(db, {});
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
    expect(byDay["2026-05-10"].pnl_sol).toBeCloseTo(0.3, 6);
    expect(byDay["2026-05-10"].trades).toBe(2);
    expect(byDay["2026-05-10"].wins).toBe(2);
    expect(byDay["2026-05-11"].pnl_sol).toBeCloseTo(-0.05, 6);
    expect(byDay["2026-05-11"].wins).toBe(0);
  });
});

describe("monthDailyPnl", () => {
  it("filters to a calendar month", () => {
    seedPosition(db, { opened: "2026-04-30", closed: "2026-04-30", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-15", closed: "2026-05-15", pnl_sol: 0.2 });
    seedPosition(db, { opened: "2026-06-01", closed: "2026-06-01", pnl_sol: 0.3 });

    const rows = monthDailyPnl(db, {}, 2026, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].day).toBe("2026-05-15");
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
npm test
```

Expected: dailyPnl / monthDailyPnl not exported.

- [ ] **Step 3: Append implementation**

Append to `dashboard/lib/queries.ts`:
```ts
export interface DailyPnlRow {
  day: string;     // YYYY-MM-DD
  pnl_sol: number;
  trades: number;
  wins: number;
}

export function dailyPnl(db: Database.Database, f: Filters): DailyPnlRow[] {
  const { clauses, params } = whereWithLimit(db, f);
  return db
    .prepare(
      `SELECT
         date(closed_at_ms / 1000, 'unixepoch') AS day,
         COALESCE(SUM(pnl_sol), 0) AS pnl_sol,
         COUNT(*) AS trades,
         COUNT(*) FILTER (WHERE pnl_sol > 0) AS wins
       FROM dry_run_positions WHERE ${clauses.join(" AND ")}
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(...params) as DailyPnlRow[];
}

export function monthDailyPnl(
  db: Database.Database,
  f: Filters,
  year: number,
  month: number,   // 1-12
): DailyPnlRow[] {
  const mm = String(month).padStart(2, "0");
  const firstDay = `${year}-${mm}-01`;
  const lastDay = lastDayOfMonth(year, month);
  return dailyPnl(db, { ...f, from: firstDay, to: lastDay });
}

function lastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return `${year}-${String(month).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm test
```

Expected: dailyPnl / monthDailyPnl tests pass.

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): daily PnL aggregation queries"
```

---

## Task 10: Query — order detail with joins (TDD)

**Files:**
- Modify: `dashboard/tests/queries.test.ts` (append)
- Modify: `dashboard/lib/queries.ts` (append)

- [ ] **Step 1: Append failing tests**

Append to `dashboard/tests/queries.test.ts`:
```ts
import { getOrderDetail, listOpenPositions, recentClosedPositions, listStrategies, cumulativePnlSeries } from "../lib/queries";

describe("getOrderDetail", () => {
  it("returns position with trades, null decision when none", () => {
    const id = seedPosition(db, { opened: "2026-05-10", closed: "2026-05-10", pnl_sol: 0.1 });
    db.prepare(
      `INSERT INTO dry_run_trades (position_id, mint, side, at_ms, price, mcap, size_sol, reason, payload_json)
       VALUES (?, 'MintX', 'buy', ?, 0.0001, 50000, 0.1, 'llm_buy', '{}')`
    ).run(id, Date.parse("2026-05-10T12:00:00Z"));

    const detail = getOrderDetail(db, id);
    expect(detail).not.toBeNull();
    expect(detail!.position.id).toBe(id);
    expect(detail!.trades).toHaveLength(1);
    expect(detail!.decision).toBeNull();
  });

  it("returns null for unknown id", () => {
    expect(getOrderDetail(db, 9999)).toBeNull();
  });
});

describe("listOpenPositions", () => {
  it("returns only status=open rows", () => {
    seedPosition(db, { opened: "2026-05-10", closed: "2026-05-10", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-11", status: "open" });
    const rows = listOpenPositions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("open");
  });
});

describe("recentClosedPositions", () => {
  it("returns N most recent closes", () => {
    for (let d = 1; d <= 7; d++) {
      seedPosition(db, { opened: `2026-05-0${d}`, closed: `2026-05-0${d}`, pnl_sol: d * 0.1 });
    }
    const rows = recentClosedPositions(db, {}, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0].pnl_sol).toBeCloseTo(0.7, 6);
  });
});

describe("listStrategies", () => {
  it("returns distinct strategy ids used", () => {
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.1, strategy: "sniper" });
    seedPosition(db, { opened: "2026-05-02", closed: "2026-05-02", pnl_sol: 0.2, strategy: "degen" });
    seedPosition(db, { opened: "2026-05-03", closed: "2026-05-03", pnl_sol: 0.3, strategy: "sniper" });
    expect(listStrategies(db).sort()).toEqual(["degen", "sniper"]);
  });
});

describe("cumulativePnlSeries", () => {
  it("returns running sum ordered by closed_at_ms", () => {
    seedPosition(db, { opened: "2026-05-01", closed: "2026-05-01", pnl_sol: 0.1 });
    seedPosition(db, { opened: "2026-05-02", closed: "2026-05-02", pnl_sol: -0.05 });
    seedPosition(db, { opened: "2026-05-03", closed: "2026-05-03", pnl_sol: 0.2 });

    const series = cumulativePnlSeries(db, {});
    expect(series.map((p) => Number(p.cumulative.toFixed(6)))).toEqual([0.1, 0.05, 0.25]);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
npm test
```

- [ ] **Step 3: Append implementations**

Append to `dashboard/lib/queries.ts`:
```ts
import type { TradeRow, LlmDecisionRow } from "./types";

export interface OrderDetail {
  position: PositionRow;
  trades: TradeRow[];
  decision: LlmDecisionRow | null;
}

export function getOrderDetail(db: Database.Database, id: number): OrderDetail | null {
  const position = db
    .prepare("SELECT * FROM dry_run_positions WHERE id = ?")
    .get(id) as PositionRow | undefined;
  if (!position) return null;

  const trades = db
    .prepare("SELECT * FROM dry_run_trades WHERE position_id = ? ORDER BY at_ms ASC")
    .all(id) as TradeRow[];

  const decision = position.llm_decision_id
    ? (db
        .prepare("SELECT * FROM llm_decisions WHERE id = ?")
        .get(position.llm_decision_id) as LlmDecisionRow | undefined) ?? null
    : null;

  return { position, trades, decision };
}

export function listOpenPositions(db: Database.Database): PositionRow[] {
  return db
    .prepare("SELECT * FROM dry_run_positions WHERE status = 'open' ORDER BY opened_at_ms DESC")
    .all() as PositionRow[];
}

export function recentClosedPositions(
  db: Database.Database,
  f: Filters,
  n: number,
): PositionRow[] {
  return listOrders(db, f, { page: 1, pageSize: n, sort: "closed_at_ms", dir: "desc" });
}

export function listStrategies(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT DISTINCT strategy_id FROM dry_run_positions WHERE strategy_id IS NOT NULL")
    .all() as { strategy_id: string }[];
  return rows.map((r) => r.strategy_id);
}

export interface CumulativePnlPoint {
  closed_at_ms: number;
  cumulative: number;
}

export function cumulativePnlSeries(db: Database.Database, f: Filters): CumulativePnlPoint[] {
  const { clauses, params } = whereWithLimit(db, f);
  const rows = db
    .prepare(
      `SELECT closed_at_ms, pnl_sol FROM dry_run_positions
       WHERE ${clauses.join(" AND ")} ORDER BY closed_at_ms ASC`
    )
    .all(...params) as { closed_at_ms: number; pnl_sol: number }[];

  let running = 0;
  return rows.map((r) => {
    running += r.pnl_sol;
    return { closed_at_ms: r.closed_at_ms, cumulative: running };
  });
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): order detail, open positions, and cumulative series queries"
```

---

## Task 11: Root layout with nav and filter bar

**Files:**
- Modify: `dashboard/app/layout.tsx`
- Modify: `dashboard/app/globals.css`
- Create: `dashboard/components/nav.tsx`
- Create: `dashboard/components/filter-bar.tsx`

- [ ] **Step 1: Replace `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { FilterBar } from "@/components/filter-bar";
import { Toaster } from "@/components/ui/sonner";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Charon",
  description: "Charon trading dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Nav />
        <div className="border-b">
          <div className="mx-auto max-w-7xl px-4 py-3">
            <Suspense fallback={null}>
              <FilterBar />
            </Suspense>
          </div>
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create the Nav component**

Create `dashboard/components/nav.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/calendar", label: "Calendar" },
  { href: "/orders", label: "Orders" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <span className="font-semibold tracking-tight">⛴ Charon</span>
        <div className="flex gap-4 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Create the FilterBar component**

Create `dashboard/components/filter-bar.tsx`:
```tsx
"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const MODES = [
  { v: "both", label: "All" },
  { v: "dry_run", label: "Dry run" },
  { v: "live", label: "Live" },
];

export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const mode = params.get("mode") ?? "both";
  const lastN = params.get("lastN") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">From</span>
        <Input type="date" value={from} onChange={(e) => update({ from: e.target.value, lastN: null })} className="w-[150px]" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">To</span>
        <Input type="date" value={to} onChange={(e) => update({ to: e.target.value, lastN: null })} className="w-[150px]" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Last N</span>
        <Input
          type="number" min={1} value={lastN} placeholder="—"
          onChange={(e) => update({ lastN: e.target.value, from: null, to: null })}
          className="w-[100px]"
        />
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">Mode: {MODES.find((m) => m.v === mode)?.label}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {MODES.map((m) => (
            <DropdownMenuItem key={m.v} onSelect={() => update({ mode: m.v === "both" ? null : m.v })}>
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={() => update({ from: null, to: null, lastN: null, mode: null, strategy: null })}>
        Reset
      </Button>
      {pending && <span className="text-muted-foreground">…</span>}
    </div>
  );
}
```

- [ ] **Step 4: Verify dev server starts and shell renders**

```bash
cd /opt/charon/dashboard
npm run dev -- --hostname 127.0.0.1 --port 3000
```

In another terminal, sanity check:
```bash
curl -s http://127.0.0.1:3000/ | grep -o "Charon"
```

Expected: `Charon`. Ctrl-C the dev server.

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): layout shell with nav and filter bar"
```

---

## Task 12: Overview page

**Files:**
- Replace: `dashboard/app/page.tsx`
- Create: `dashboard/components/pnl-sparkline.tsx`

- [ ] **Step 1: Install Recharts**

```bash
cd /opt/charon/dashboard
npm install recharts
```

- [ ] **Step 2: Create the sparkline component**

Create `dashboard/components/pnl-sparkline.tsx`:
```tsx
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
```

- [ ] **Step 3: Replace `app/page.tsx`**

```tsx
import { db } from "@/lib/db";
import { overviewMetrics, listOpenPositions, recentClosedPositions, cumulativePnlSeries } from "@/lib/queries";
import { parseFilters } from "@/lib/filters";
import { formatSol, formatPercent, truncateMint, formatRelativeTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PnlSparkline } from "@/components/pnl-sparkline";
import Link from "next/link";

export const revalidate = 30;

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
```

- [ ] **Step 4: Verify in browser**

```bash
cd /opt/charon/dashboard
npm run dev -- --hostname 127.0.0.1 --port 3000
```

In a separate session/terminal, set up an SSH tunnel if you're verifying from your local machine:
```bash
ssh -L 3000:127.0.0.1:3000 user@vps   # from your local machine
```

Then open `http://localhost:3000/` and confirm:
- A big realized-PnL number renders
- The sparkline draws a line
- "Open now" shows current open positions count
- "Recent closes" lists 5 entries

Take a screenshot or note any visual issues to address in cleanup.

- [ ] **Step 5: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): overview page with PnL, stats, sparkline, open + recent"
```

---

## Task 13: Orders list page

**Files:**
- Create: `dashboard/app/orders/page.tsx`
- Create: `dashboard/components/orders-table.tsx`

- [ ] **Step 1: Create the table component**

Create `dashboard/components/orders-table.tsx`:
```tsx
"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { PositionRow } from "@/lib/types";
import { formatSol, formatPercent, formatMcap, truncateMint, formatRelativeTime, formatDuration } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const COLUMNS = [
  { key: "closed_at_ms", label: "Closed" },
  { key: "symbol", label: "Symbol" },
  { key: "entry_mcap", label: "Entry mcap" },
  { key: "exit_mcap", label: "Exit mcap" },
  { key: "pnl_sol", label: "PnL" },
  { key: "pnl_percent", label: "%" },
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
        <Button asChild variant="outline" size="sm">
          <Link href={`/orders/export?${params.toString()}`}>Export CSV</Link>
        </Button>
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
                <TableCell><Link href={`/orders/${r.id}`}>{formatMcap(r.entry_mcap)}</Link></TableCell>
                <TableCell><Link href={`/orders/${r.id}`}>{formatMcap(r.exit_mcap)}</Link></TableCell>
                <TableCell className={pnlColor}>
                  <Link href={`/orders/${r.id}`}>{formatSol(r.pnl_sol)}</Link>
                </TableCell>
                <TableCell className={pnlColor}>
                  <Link href={`/orders/${r.id}`}>{formatPercent(r.pnl_percent)}</Link>
                </TableCell>
                <TableCell><Link href={`/orders/${r.id}`}>{r.exit_reason ?? "—"}</Link></TableCell>
                <TableCell><Link href={`/orders/${r.id}`}><Badge variant="outline">{r.strategy_id}</Badge></Link></TableCell>
                <TableCell><Link href={`/orders/${r.id}`}>{formatDuration(duration)}</Link></TableCell>
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
```

- [ ] **Step 2: Create the page**

Create `dashboard/app/orders/page.tsx`:
```tsx
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { listOrders, countOrders } from "@/lib/queries";
import { OrdersTable } from "@/components/orders-table";

export const revalidate = 30;

const PAGE_SIZE = 50;

const VALID_SORTS = new Set(["opened_at_ms", "closed_at_ms", "pnl_sol", "pnl_percent", "entry_mcap", "exit_mcap", "symbol"]);

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);
  const filters = parseFilters(params);

  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const sortRaw = params.get("sort") ?? "closed_at_ms";
  const sort = (VALID_SORTS.has(sortRaw) ? sortRaw : "closed_at_ms") as Parameters<typeof listOrders>[2]["sort"];
  const dirRaw = params.get("dir");
  const dir: "asc" | "desc" = dirRaw === "asc" ? "asc" : "desc";

  const total = countOrders(db, filters);
  const rows = listOrders(db, filters, { page, pageSize: PAGE_SIZE, sort, dir });

  return <OrdersTable rows={rows} total={total} page={page} pageSize={PAGE_SIZE} sort={sort} dir={dir} />;
}
```

- [ ] **Step 3: Verify in browser**

Run dev server, open `/orders`. Confirm:
- Table renders with 50 rows
- Column headers toggle sort
- Pagination Prev/Next works
- Clicking a row links to `/orders/[id]` (will 404 until task 14 — that's OK)

- [ ] **Step 4: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): orders list page with sort and pagination"
```

---

## Task 14: CSV export route

**Files:**
- Create: `dashboard/app/orders/export/route.ts`

- [ ] **Step 1: Create the route**

Create `dashboard/app/orders/export/route.ts`:
```ts
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { listOrders, countOrders } from "@/lib/queries";
import type { PositionRow } from "@/lib/types";

const EXPORT_CAP = 10_000;

const VALID_SORTS = new Set(["opened_at_ms", "closed_at_ms", "pnl_sol", "pnl_percent", "entry_mcap", "exit_mcap", "symbol"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filters = parseFilters(url.searchParams);
  const sortRaw = url.searchParams.get("sort") ?? "closed_at_ms";
  const sort = (VALID_SORTS.has(sortRaw) ? sortRaw : "closed_at_ms") as Parameters<typeof listOrders>[2]["sort"];
  const dir: "asc" | "desc" = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  const total = Math.min(countOrders(db, filters), EXPORT_CAP);
  const rows = listOrders(db, filters, { page: 1, pageSize: total, sort, dir });

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
    r.exit_reason ?? "",
    r.size_sol,
  ];
  return cells.map((c) => csvEscape(String(c))).join(",");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
```

- [ ] **Step 2: Verify export**

With dev server running, open `http://localhost:3000/orders/export?lastN=10` in a browser. Expected: a CSV file downloads with 10 rows + header.

- [ ] **Step 3: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): CSV export route for orders"
```

---

## Task 15: Calendar page with month grid

**Files:**
- Create: `dashboard/app/calendar/page.tsx`
- Create: `dashboard/components/calendar-grid.tsx`

- [ ] **Step 1: Create the calendar grid component**

Create `dashboard/components/calendar-grid.tsx`:
```tsx
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
  const bgClass = !cell.inMonth
    ? "bg-transparent"
    : trades === 0
    ? "bg-muted/30"
    : pnl > 0
    ? `bg-emerald-500/[${(0.1 + intensity * 0.35).toFixed(2)}]`
    : `bg-red-500/[${(0.1 + intensity * 0.35).toFixed(2)}]`;

  const todayRing = cell.isToday ? "ring-2 ring-primary" : "";

  const content = (
    <div className={`min-h-[88px] rounded-md border p-2 text-xs ${bgClass} ${todayRing} ${cell.inMonth ? "" : "opacity-30"}`}>
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
  return <Link href={`/orders?${linkParams.toString()}`}>{content}</Link>;
}
```

Note on the intensity class: Tailwind doesn't compile dynamic arbitrary opacity from a template literal at build time. Replace it with a small lookup or inline `style` — simpler:

Replace the `bgClass` computation with this version (use inline style instead of dynamic Tailwind):
```tsx
  const bgStyle: React.CSSProperties = {};
  if (cell.inMonth && trades > 0) {
    const alpha = 0.12 + intensity * 0.38;
    bgStyle.backgroundColor = pnl > 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`;
  } else if (cell.inMonth) {
    bgStyle.backgroundColor = "rgba(120,120,120,0.05)";
  }
```

And use `style={bgStyle}` instead of the dynamic class. Drop the `bgClass` variable. The final outer div looks like:
```tsx
<div style={bgStyle} className={`min-h-[88px] rounded-md border p-2 text-xs ${todayRing} ${cell.inMonth ? "" : "opacity-30"}`}>
```

- [ ] **Step 2: Create the page**

Create `dashboard/app/calendar/page.tsx`:
```tsx
import { db } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import { monthDailyPnl } from "@/lib/queries";
import { CalendarGrid } from "@/components/calendar-grid";

export const revalidate = 30;

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
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") params.set(k, v);
  const filters = parseFilters(params);

  const now = new Date();
  const year = Number(params.get("year") ?? now.getUTCFullYear());
  const month = Number(params.get("month") ?? now.getUTCMonth() + 1);

  // Note: monthDailyPnl injects its own from/to — strip any URL date filters for this query so calendar always shows the picked month, but keep strategy/mode.
  const monthFilters = { strategy: filters.strategy, mode: filters.mode };
  const rows = monthDailyPnl(db, monthFilters, year, month);
  const byDay = new Map(rows.map((r) => [r.day, { pnl_sol: r.pnl_sol, trades: r.trades, wins: r.wins }]));
  const cells = buildCells(year, month, byDay);

  return <CalendarGrid year={year} month={month} cells={cells} />;
}
```

- [ ] **Step 3: Verify**

Open `http://localhost:3000/calendar`. Confirm:
- Month grid renders 5–6 rows × 7 columns
- Today gets a ring
- Days with closed trades show PnL + count + win%
- Prev/Next navigates months
- Clicking a populated day jumps to `/orders?from=...&to=...`

- [ ] **Step 4: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): calendar page with monthly grid"
```

---

## Task 16: Order detail page

**Files:**
- Create: `dashboard/app/orders/[id]/page.tsx`

- [ ] **Step 1: Create the page**

Create `dashboard/app/orders/[id]/page.tsx`:
```tsx
import { db } from "@/lib/db";
import { getOrderDetail } from "@/lib/queries";
import { formatSol, formatPercent, formatMcap, truncateMint } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notFound } from "next/navigation";

export const revalidate = 30;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">PnL</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
```

- [ ] **Step 2: Verify**

Open `http://localhost:3000/orders/<some-id-from-list>` (click a row on `/orders`). Confirm header, PnL card, trade log, candidate snapshot all render. Verify a position with an LLM decision shows the decision card.

- [ ] **Step 3: Commit**

```bash
cd /opt/charon
git add dashboard/
git commit -m "feat(dashboard): order detail page"
```

---

## Task 17: Production build + smoke-test all routes

**Files:**
- None (verification task)

- [ ] **Step 1: Run production build**

```bash
cd /opt/charon/dashboard
npm run build
```

Expected: build completes. There will be warnings about dynamic rendering (server components using `searchParams` opt into dynamic), which is intentional.

- [ ] **Step 2: Start the production server**

```bash
HOST=127.0.0.1 PORT=3000 npm run start -- --hostname 127.0.0.1
```

(Or `npm run start` if you can't pass `--hostname`; default binds to all interfaces — fine since the VPS has no inbound. For belt-and-suspenders, keep `--hostname 127.0.0.1`.)

- [ ] **Step 3: Smoke-test routes**

In another shell:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/calendar
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/orders
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/orders/export?lastN=5"
```

Expected: four `200`s.

- [ ] **Step 4: Stop the server (Ctrl-C) and commit anything new**

(If task 16 left any cleanups, commit them now. Otherwise no-op.)

---

## Task 18: systemd unit for the Next.js server

**Files:**
- Create: `/etc/systemd/system/charon-dashboard.service`

- [ ] **Step 1: Confirm Node binary path**

```bash
which node
which npm
```

Note the absolute path to `node` and the npm binary path. If using nvm, prefer `readlink -f $(which node)` to get the real path.

- [ ] **Step 2: Create the unit**

Write `/etc/systemd/system/charon-dashboard.service` (requires sudo):
```ini
[Unit]
Description=Charon Dashboard (Next.js)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/charon/dashboard
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=CHARON_DB_PATH=/opt/charon/charon.sqlite
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Adjust `User=`, `/usr/bin/npm`, and the working directory to match your environment.

- [ ] **Step 3: Enable and start**

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now charon-dashboard
sudo systemctl status charon-dashboard --no-pager
```

Expected: `active (running)`. Logs:
```bash
sudo journalctl -u charon-dashboard -n 50 --no-pager
```

- [ ] **Step 4: Confirm it serves**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

Expected: `200`.

- [ ] **Step 5: Commit the unit file (optional, for reproducibility)**

Copy the unit into the repo:
```bash
mkdir -p /opt/charon/dashboard/deploy
cp /etc/systemd/system/charon-dashboard.service /opt/charon/dashboard/deploy/
cd /opt/charon
git add dashboard/deploy/
git commit -m "chore(dashboard): record systemd unit in repo"
```

---

## Task 19: cloudflared install + tunnel

**Pre-reqs:** Phase 1 (domain on Cloudflare) and Phase 2 (Zero Trust enabled) from the spec must be done before this task. Substitute your real hostname for `charon.example.com` below.

**Files:**
- Create: `/etc/cloudflared/config.yml`
- Create: `/etc/systemd/system/cloudflared.service` (via cloudflared installer)

- [ ] **Step 1: Install cloudflared**

```bash
# Debian/Ubuntu
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

Expected: prints a version like `2025.x.x`.

- [ ] **Step 2: Authenticate**

```bash
cloudflared tunnel login
```

This prints a URL. Open it in a browser on any device (SSH port forward not needed — just visit the URL), select your zone (`yourdomain.com`), and authorize. A `cert.pem` is written to `~/.cloudflared/`.

- [ ] **Step 3: Create the tunnel**

```bash
cloudflared tunnel create charon-dashboard
```

Expected output includes a UUID and "Tunnel credentials written to `~/.cloudflared/<UUID>.json`". Note the UUID.

- [ ] **Step 4: Route DNS for the subdomain**

```bash
cloudflared tunnel route dns charon-dashboard charon.yourdomain.com
```

Expected: creates a CNAME `charon.yourdomain.com → <UUID>.cfargotunnel.com` (proxied — orange cloud) in your Cloudflare DNS.

- [ ] **Step 5: Write the cloudflared config**

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/
```

Create `/etc/cloudflared/config.yml`:
```yaml
tunnel: <UUID>
credentials-file: /etc/cloudflared/<UUID>.json

ingress:
  - hostname: charon.yourdomain.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

- [ ] **Step 6: Install + start the systemd service**

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared --no-pager
```

Expected: active (running). Verify logs:
```bash
sudo journalctl -u cloudflared -n 30 --no-pager
```

You should see "Registered tunnel connection" messages.

- [ ] **Step 7: Confirm public reachability (HTTP)**

From any machine (including your phone):
```bash
curl -I https://charon.yourdomain.com/
```

Expected: at this point you'll likely get a 302 redirect to a Cloudflare Access login page (because the Access policy in the next task isn't set yet — actually since no Access app exists for this host yet, you may get a 200 with the dashboard exposed publicly). **Do not browse to the site in a browser yet** — proceed straight to Task 20 to lock it down.

---

## Task 20: Cloudflare Access policy + final smoke test

**Files:** None (config in Cloudflare dashboard UI)

- [ ] **Step 1: Add the Access application**

In Cloudflare → Zero Trust → Access → Applications → **Add an application** → **Self-hosted**:
- Application name: `Charon Dashboard`
- Session duration: 24 hours
- Application domain: `charon.yourdomain.com` (subdomain + your zone)
- Identity providers: leave default (One-time PIN)

- [ ] **Step 2: Add an Allow policy**

In the same application's Policies:
- Policy name: `Owner`
- Action: **Allow**
- Configure rules: Include → **Emails** → `andreas.unggun@gmail.com`

Save.

- [ ] **Step 3: Browser smoke test**

Open `https://charon.yourdomain.com/` in a fresh browser.

Expected flow:
1. Redirected to Cloudflare Access login
2. Enter your email
3. Cloudflare emails you a 6-digit PIN
4. Enter the PIN → redirected back
5. Charon dashboard loads, Overview page renders real numbers

Verify each page works:
- `/`
- `/calendar`
- `/orders`
- Click into an order detail
- Try `/orders/export?lastN=10` — CSV downloads

- [ ] **Step 4: Negative test — confirm unauthorized email is blocked**

Open the URL in a private/incognito window (or use a different email). Try to log in with an email NOT in the allowlist. Expected: Cloudflare denies with "your email is not allowed."

- [ ] **Step 5: Commit deploy README**

Create `dashboard/README.md`:
```md
# Charon Dashboard

Private Next.js dashboard for Charon trading bot, exposed via Cloudflare Tunnel + Zero Trust Access.

## Local dev

    cd dashboard
    npm install
    npm run dev -- --hostname 127.0.0.1 --port 3000

## Tests

    npm test

## Production (on the VPS)

Managed by systemd. Status:

    sudo systemctl status charon-dashboard
    sudo systemctl status cloudflared

Logs:

    sudo journalctl -u charon-dashboard -f
    sudo journalctl -u cloudflared -f

Deploy a new version:

    cd /opt/charon
    git pull
    cd dashboard && npm install && npm run build
    sudo systemctl restart charon-dashboard

## Architecture

See `docs/superpowers/specs/2026-05-21-dashboard-design.md`.
```

```bash
cd /opt/charon
git add dashboard/README.md
git commit -m "docs(dashboard): operations README"
```

---

## Self-Review (done during plan authoring)

**Spec coverage:**
- Architecture / code layout → Tasks 1–3 ✓
- Tech stack (Next 15, Tailwind v4, shadcn, better-sqlite3, Recharts, vitest) → Tasks 1, 2, 3, 4, 12 ✓
- Read-only DB handle → Task 3 ✓
- Global filters → Task 5 (parser), Task 11 (UI) ✓
- Overview page → Task 12 ✓
- Calendar (month grid, click-through) → Task 15 ✓
- Orders list (sort/paginate/CSV) → Tasks 13, 14 ✓
- Order detail (snapshot, LLM decision, trade log) → Task 16 ✓
- Deploy (cloudflared, systemd, Access policy) → Tasks 18, 19, 20 ✓
- Open-position "peak unrealized" labeling → Task 12 ✓ (labeled "peak — not current")
- CSV export cap at 10,000 rows → Task 14 ✓
- 30s revalidate polling → all page tasks use `export const revalidate = 30` ✓

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate error handling". A few `<UUID>` and `yourdomain.com` placeholders in Task 19–20 are intentional and clearly flagged as user-substituted values.

**Type consistency:** `Filters`, `PositionRow`, `OrdersListOptions`, query function signatures are referenced consistently across tasks 5–16. Sort column whitelist (`VALID_SORTS`) appears in tasks 8, 13, 14 with the same membership.
