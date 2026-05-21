# Charon Dashboard — Design

**Date:** 2026-05-21
**Status:** Approved (pending user spec review)
**Owner:** andreas.unggun@gmail.com

## Goal

Build a private web dashboard that surfaces Charon's trading performance — realized PnL, daily activity, and per-order detail — for both dry-run and (eventually) live execution modes. Read-only in v1; no mutations to bot state.

## Non-goals (v1)

- Live price oracle for unrealized PnL on open positions (use last `high_water_price` as approximation)
- Editing strategy config from the dashboard (Telegram `/stratset` already handles this)
- LLM decision analytics ("which prompts produced wins?") — separate future spec
- Multi-user / RBAC — single-user dashboard
- Real-time push (WebSocket / SSE) — use 30s polling via Next.js `revalidate`
- Pump.fun bonding-curve or liquidity charts

## Architecture

### Code layout

Co-located in the Charon repo as an isolated subdirectory:

```
/opt/charon/
├── src/                  ← bot (unchanged)
├── charon.sqlite         ← shared DB; opened read-only by dashboard
├── dashboard/            ← NEW
│   ├── package.json      ← own deps, isolated from bot
│   ├── app/              ← Next.js 15 App Router
│   ├── components/       ← shadcn/ui + custom
│   ├── lib/
│   │   ├── db.ts         ← better-sqlite3 readonly handle
│   │   ├── queries.ts    ← typed query functions
│   │   └── filters.ts    ← URL filter parsing/serialization
│   └── ...
└── ...
```

**Rationale:** Same repo keeps git history and DB schema understanding in sync. Subdirectory isolation prevents Next.js's `node_modules` from polluting the bot's deps; the bot's deploy/start scripts ignore `dashboard/` entirely.

### Tech stack

- **Next.js 15** (App Router, React Server Components)
- **Tailwind v4**
- **shadcn/ui** for primitives (Button, Card, Table, Tabs, DatePicker, etc.)
- **better-sqlite3** opened with `{ readonly: true, fileMustExist: true }` against `../charon.sqlite`
- **Recharts** for sparkline and PnL line charts
- **No API layer.** Server components query SQLite directly; mutations are out of scope.

### Data access

- WAL mode is already enabled in Charon → multi-process reads don't block bot writes.
- Dashboard opens the SQLite handle in **readonly** mode so it can never corrupt bot state.
- Query functions live in `lib/queries.ts` and are called from RSCs. No HTTP API.
- For pages with filters, server components revalidate every 30s (`export const revalidate = 30`).

### Deployment & exposure

**Cloudflare Tunnel + Zero Trust Access**, single-user.

- `cloudflared` runs as a systemd service on the VPS. Outbound-only — no inbound ports opened, no nginx, no certbot.
- Next.js binds to `127.0.0.1:3000` (localhost only).
- Tunnel reverse-proxies `https://charon.<user-domain>` → `127.0.0.1:3000`.
- Cloudflare Zero Trust Access policy restricts the hostname to a single email (`andreas.unggun@gmail.com`). Login uses Cloudflare's one-time PIN (6-digit code emailed on each new session, 24h validity).
- HTTPS terminated by Cloudflare; no app-level TLS or auth code required.

**User domain prerequisites (one-time, done before implementation deploy):**

1. Add domain to Cloudflare (free plan), keep registration at current registrar.
2. Verify Vercel records (portfolio site) are imported, set to **DNS-only** (gray cloud), not Proxied.
3. Replace nameservers at registrar with the two Cloudflare nameservers.
4. Enable Zero Trust (free up to 50 users).

Phases 3 (tunnel setup) and 4 (Access policy) are part of the implementation plan.

**Why this architecture (vs alternatives):**

| Option | Why rejected |
|---|---|
| Open port + basic auth + nginx | More config surface, manual TLS renewal, weaker than Access |
| Vercel frontend + VPS API | Requires exposing VPS API publicly — defeats no-inbound security stance |
| Tailscale | Requires Tailscale client on every device (mobile awkward) |
| SSH tunnel | Requires terminal on every device |
| Separate repo | Splits git history; DB schema drift risk |

## Data model

Primary source: `dry_run_positions` (despite the name, `execution_mode` column distinguishes `dry_run` from `live`; this table holds both).

Supporting:
- `dry_run_trades` — buy/sell events per position
- `llm_decisions` — joined for order detail page
- `strategies` — for strategy filter dropdown

No schema changes required.

### Key derived metrics

**Realized PnL (headline):**
```sql
SELECT SUM(pnl_sol) AS total_pnl_sol
FROM dry_run_positions
WHERE status = 'closed' AND <filters>
```

**Win rate:**
```sql
SELECT
  COUNT(*) FILTER (WHERE pnl_sol > 0) * 1.0 / NULLIF(COUNT(*), 0) AS win_rate,
  COUNT(*) AS total_trades
FROM dry_run_positions
WHERE status = 'closed' AND <filters>
```

**Daily aggregation (calendar):**
```sql
SELECT
  date(closed_at_ms / 1000, 'unixepoch') AS day,
  SUM(pnl_sol) AS pnl_sol,
  COUNT(*) AS trades,
  COUNT(*) FILTER (WHERE pnl_sol > 0) AS wins
FROM dry_run_positions
WHERE status = 'closed' AND <filters>
GROUP BY day
```

**Open positions (in-flight card):**
```sql
SELECT COUNT(*) AS open_count, SUM(size_sol) AS sol_at_risk
FROM dry_run_positions WHERE status = 'open' AND <filters>
```

## Global filters (URL state)

All filters are URL query parameters; every page reads the same params and switching pages preserves them.

| Param | Type | Default | Notes |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | (none) | Mutually exclusive with `lastN` / `firstN` |
| `to` | `YYYY-MM-DD` | (none) | Inclusive |
| `lastN` | int | (none) | "Last N closed positions" |
| `firstN` | int | (none) | "First N closed positions" |
| `strategy` | string | (none = all) | `sniper`, etc. |
| `mode` | enum | `both` | `dry_run` \| `live` \| `both` |

Filter UI lives in a sticky header bar above the page content.

## Pages

### `/` — Overview

- **Big number:** Total realized PnL in SOL, with % return on cumulative capital deployed below
- **Stat row:** total trades · win rate · avg winner · avg loser · best single trade · worst single trade
- **Sparkline:** Cumulative PnL over time (one point per closed trade)
- **"Open now" card:** count of open positions + total SOL at risk + peak-unrealized-% (computed as `(high_water_price - entry_price) / entry_price` per position, then aggregated; labeled "peak since entry — not current"). No current/low values available without a live oracle.
- **Recent closes table:** 5 most recent closed positions, links to `/orders/[id]`

### `/calendar` — Monthly calendar

True month-grid layout (not a heatmap):

- Header row: Sun · Mon · Tue · Wed · Thu · Fri · Sat
- 5–6 week rows showing every day of the current month
- Days outside the current month rendered in faint gray (standard convention)
- Today gets an accent border
- Month nav: prev/next buttons + month/year picker
- Each day cell shows:
  ```
  ┌─────────────────┐
  │ 14              │  ← date number (top-left)
  │ +0.42 SOL       │  ← PnL, color-coded green/red
  │ 5 · 60% win     │  ← trades count · win rate
  └─────────────────┘
  ```
- Empty (no-trade) days: just the date number, muted background
- Trade days: subtle background tint (green/red, intensity scaled to PnL magnitude)
- Click a day → `/orders?from=YYYY-MM-DD&to=YYYY-MM-DD`

Built as a small custom grid component (shadcn's `Calendar` is a date picker, not a month grid).

### `/orders` — Orders list

- Server-side paginated table, 50 rows per page
- Columns: `opened_at` (relative time) · symbol · mint (truncated, copy button) · entry_mcap · exit_mcap · `pnl_sol` · `pnl_%` · exit_reason · strategy · duration held
- Sortable by any column (click header → URL `?sort=pnl_sol&dir=desc`)
- Row click → `/orders/[id]`
- "Export CSV" button — respects current filters and sort

### `/orders/[id]` — Order detail

- Header: symbol · mint · status badge (open/closed) · opened/closed timestamps
- PnL card: entry price/mcap · exit price/mcap · `pnl_sol` · `pnl_%` · exit_reason
- Candidate snapshot: pretty-printed JSON from `snapshot_json` (the metrics captured at decision time)
- LLM decision: joined from `llm_decisions.id = position.llm_decision_id` if present (reason + verdict)
- Trade log: rows from `dry_run_trades` for this `position_id`, chronological

## Implementation phases

Sized for sequential execution by writing-plans:

1. **Scaffold** — `dashboard/` subdirectory, Next.js 15, Tailwind v4, shadcn/ui init, `lib/db.ts` readonly handle, smoke-test query that prints total PnL.
2. **Data layer** — `lib/queries.ts` (typed query functions), `lib/filters.ts` (URL parsing/serialization), shared filter bar component.
3. **Overview page** — big number, stat row, sparkline, open-now card, recent closes table.
4. **Orders list** — paginated table, sortable columns, CSV export, filter bar wiring.
5. **Calendar page** — month-grid component, daily aggregation query, prev/next nav, click-through to filtered Orders.
6. **Order detail** — snapshot rendering, joined LLM decision, trade log.
7. **Deploy** — `cloudflared` install + tunnel create + DNS route + systemd service; Cloudflare Access application + Allow policy for user email. Smoke-test from outside the VPS.

## Open questions

None outstanding. User has approved architecture, deployment, feature scope, and calendar layout.

## Risks

- **Calendar empty when no closed trades in selected month** — Acceptable; render the grid with all empty cells.
- **Open-position pseudo-PnL labeling** — Must be clearly labeled "peak since entry" so it's never confused with realized PnL or current unrealized.
- **CSV export on large filtered sets** — Cap at 10,000 rows in v1; show toast if truncated. (310 current rows make this a far-future concern.)
- **Cloudflare Access PIN to Gmail** — If Gmail is unreachable, dashboard is unreachable. Mitigation: Access supports multiple identity providers (Google OAuth, GitHub) as a phase-2 add if it ever bites.
