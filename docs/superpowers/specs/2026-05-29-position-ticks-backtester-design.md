# Position Ticks + Exit Backtester — Design

Date: 2026-05-29
Status: Approved (pending spec review)

## Motivation

Analysis of the last 16 closed `degen` positions showed a broken risk
asymmetry: avg win +18.9% vs avg loss −41.5%, net −0.091 SOL. Six of eight
losses were RUG_GUARD exits at −47% to −54%. The de facto stop was −50% (the
rug guard), because `sl_percent` was −90. `sl_percent` has since been set to
−25.

Two follow-up needs emerged that this project addresses:

1. **We cannot precisely tune SL/trailing levels.** We only persist
   high-water and low-water marks per position, not the price path. We can
   approximate from low-water but cannot faithfully replay alternative exit
   rules.
2. **The static entry snapshot does not separate rugs from winners** (the same
   mints both won and lost on different entries). The losses are driven by
   entry timing and post-entry dynamics — which we currently do not record.

This project captures the per-position price/state time-series and provides a
backtester to replay alternative exit rules against it.

## Scope

In scope (the recommended subset of the 5 data-collection points):

- **Point 1** — per-position price/state time-series (`position_ticks`).
- **Point 2** — early-velocity data, derived from ticks (5m buy/sell, volume,
  price change captured each tick; first-N-seconds behavior is a query over
  ticks, no extra code).
- **Point 4 (cheap part)** — `holder_count` and `top_holders_pct` per tick, so
  holder churn vs entry is observable. Both already present in the asset object;
  no extra API calls.

Explicitly out of scope (deferred — data-source / config issues, not solvable
in this build):

- **Point 3** — bundler rate / rug ratio source wiring. The `trending` object
  from Jupiter does not carry these; needs a separate data source investigation.
- **Point 5** — saved-wallets / `savedWalletExposure` fix. Configuration/data
  issue, tracked separately.

## Components

### 1. `position_ticks` table

Created in `initDb()` (`src/db/connection.js`) using the existing
`CREATE TABLE IF NOT EXISTS` pattern. No `ensureColumn` needed (new table).

```sql
CREATE TABLE IF NOT EXISTS position_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  mint TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  ms_since_open INTEGER NOT NULL,
  price REAL,
  mcap REAL,
  pnl_percent REAL,
  high_water_mcap REAL,
  low_water_mcap REAL,
  trailing_armed INTEGER,
  liquidity_usd REAL,
  holder_count INTEGER,
  buys_5m INTEGER,
  sells_5m INTEGER,
  vol_5m REAL,
  price_change_5m REAL,
  top_holders_pct REAL
);
CREATE INDEX IF NOT EXISTS idx_position_ticks_pos ON position_ticks(position_id, at_ms);
```

Field sources (all already fetched/computed in `refreshPosition()`):

| Column | Source |
|---|---|
| price, mcap, pnl_percent | computed in `refreshPosition()` |
| high_water_mcap, low_water_mcap, trailing_armed | computed in `refreshPosition()` |
| liquidity_usd, holder_count | `asset.liquidity`, `asset.holderCount` |
| buys_5m, sells_5m, vol_5m, price_change_5m | `asset.stats5m.{numBuys,numSells,volume,priceChange}` |
| top_holders_pct | `asset.audit.topHoldersPercentage` |
| ms_since_open | `at_ms - position.opened_at_ms` |

**Write path:** one `INSERT` per monitor cycle per open position, inside
`refreshPosition()`, after the high/low-water update. Applies to both dry-run
and live positions. The insert is wrapped in try/catch and logged on failure so
a tick write can never block or fail an exit. New module `src/db/ticks.js`
exposes `insertPositionTick(...)` and a `pruneTicks(olderThanMs)` helper.

**Retention:** ticks are small numeric rows (~720 for a 2h position at the 10s
`POSITION_CHECK_MS` cadence). Keep all by default; provide `pruneTicks` to drop
ticks for positions closed more than 14 days ago. Pruning is manual/occasional,
not on the hot path.

### 2. `evaluateExit()` — shared pure exit logic

New module `src/execution/exitLogic.js`:

```js
evaluateExit(positionState, tick, strat) → {
  exitReason,            // 'MAX_HOLD' | 'RUG_GUARD' | 'SL' | 'TP' | 'TRAILING_TP' | null
  trailingArmed,         // boolean
  partialTpTriggered,    // boolean (true only on the tick it first crosses partial_tp_at)
  highWaterMcap,
  lowWaterMcap,
  pnlPercent,
  peakPnlPercent
}
```

Pure — no DB writes, no network, no side effects. Encodes the exact current
decision order from `refreshPosition()`:

1. MAX_HOLD (if `strat.max_hold_ms > 0` and elapsed ≥ it)
2. partial TP trigger (sets `partialTpTriggered`; does not exit)
3. RUG_GUARD (trail drop ≤ −`rug_guard_drop_pct`) — takes label precedence
4. SL (pnl ≤ `sl_percent`)
5. TP (pnl ≥ `tp_percent`, only when trailing disabled)
6. TRAILING_TP (armed and trail drop ≤ −`trailing_percent`)

Trailing arms when `peakPnlPercent ≥ trailing_arm_at_percent` (matching current
behavior), independent of TP-hit.

`refreshPosition()` is refactored to call `evaluateExit()` for the decision,
then perform the side effects (water-mark UPDATE, partial-TP sell + trade row,
close UPDATE + trade row, live sell) exactly as today. This is behavior-
preserving; verified by re-running the existing test suite (`npm test`).

### 3. `scripts/backtest.js` — CLI backtester (read-only)

```bash
node scripts/backtest.js --strategy degen --window 7d \
  --sl -25 --trail 10 --arm 15 --rug 50 --partial-at 15 --partial-sell 50

node scripts/backtest.js --strategy degen --window 7d --sweep sl=-15,-20,-25,-30
```

Behavior:

- Select closed positions matching `--strategy` within `--window` that have
  ticks.
- Build the override strat by merging provided flags over each position's real
  strat config.
- Replay the position's ticks (ordered by `at_ms`) through `evaluateExit()`,
  threading state (high/low water, trailing_armed, partial_tp_done) tick to
  tick. Stop at the first `exitReason`. Apply partial TP at the tick it triggers
  (sell `partial_tp_sell_percent` of size at that tick's mcap, continue the
  remainder).
- Simulated P&L per position: `pnl_percent` from exit-tick mcap vs entry mcap;
  `pnl_sol = size_sol * pnl_percent / 100` (blended with the partial leg when
  partial TP fired).
- Output: comparison table — baseline (actual closed P&L) vs simulated — with
  total SOL, win rate, avg win, avg loss, and exit-reason breakdown, plus
  per-position diffs. `--sweep` prints one summary row per parameter value.
- **Read-only.** The script never writes to the DB.

Flag → strat-field map: `--sl`→`sl_percent`, `--tp`→`tp_percent`,
`--trail`→`trailing_percent`, `--arm`→`trailing_arm_at_percent`,
`--rug`→`rug_guard_drop_pct`, `--partial-at`→`partial_tp_at_percent`,
`--partial-sell`→`partial_tp_sell_percent`.

## Limitations (must be stated in backtester output)

- **Forward-looking only.** Ticks exist only for positions opened after this
  ships. The existing 16 positions have no ticks and cannot be backtested here;
  the low-water approximation already done stands for them.
- **Tick-granularity bound.** Fidelity is limited by the 10s
  `POSITION_CHECK_MS` cadence and by Jupiter price latency. Intra-tick wicks are
  not captured, so simulated SL/trail fills are as-of-tick, not exact.
- **No slippage/fee model.** Simulated fills use tick mcap; real fills differ from
  slippage and priority/Jito fees. Treat results as relative comparisons
  between rule sets, not absolute predictions.

## Testing

- `evaluateExit()`: unit tests in `tests/` covering each exit branch (SL, TP,
  trailing arm + fire, rug guard precedence over SL, partial TP trigger,
  max-hold) and the no-exit case.
- Refactor safety: existing suite (`npm test`, `:memory:` DB) must still pass,
  confirming `refreshPosition()` behavior is unchanged.
- Backtester: a small fixture of synthetic ticks verifying baseline-vs-sim
  math and that a tighter SL reduces a known loss.

## Files

- `src/db/connection.js` — add `position_ticks` table + index in `initDb()`.
- `src/db/ticks.js` — new: `insertPositionTick`, `pruneTicks`.
- `src/execution/exitLogic.js` — new: `evaluateExit` pure function.
- `src/execution/positions.js` — refactor `refreshPosition()` to use
  `evaluateExit` and write a tick each cycle.
- `scripts/backtest.js` — new: CLI backtester.
- `tests/exitLogic.test.js`, `tests/backtest.test.js` — new.
