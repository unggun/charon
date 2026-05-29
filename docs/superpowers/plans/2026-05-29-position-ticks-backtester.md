# Position Ticks + Exit Backtester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a per-position price/state time-series (`position_ticks`) and provide a read-only CLI backtester that replays alternative SL/TP/trailing/rug rules against it, sharing one pure exit-decision function with the live monitor.

**Architecture:** A new `position_ticks` table is written once per monitor cycle per open position from data `refreshPosition()` already fetches (no new API calls). The SL/TP/trailing/rug/partial decision is extracted from `refreshPosition()` into a pure `evaluateExit()` function used by both the live monitor and `scripts/backtest.js`, guaranteeing the backtest matches live behavior.

**Tech Stack:** Node.js (ESM), better-sqlite3, `node:test` + `node:assert/strict`. Tests run with `DB_PATH=:memory:` via `npm test`.

---

## File Structure

- `src/db/connection.js` — add `position_ticks` table + index in `initDb()` (existing migration pattern).
- `src/db/ticks.js` — **new**: `insertPositionTick`, `ticksForPosition`, `pruneTicks`. Pure DB access, no business logic.
- `src/execution/exitLogic.js` — **new**: `evaluateExit(position, tick, strat)` pure function.
- `src/execution/positions.js` — refactor `refreshPosition()` to call `evaluateExit()`; write one tick per cycle.
- `scripts/backtest.js` — **new**: CLI backtester; exports `simulate` + `summarize` for tests, CLI guarded by `import.meta.url` check.
- `tests/execution/exitLogic.test.js` — **new**: unit tests per exit branch.
- `tests/execution/backtest.test.js` — **new**: simulate/summarize math.
- `tests/db/ticks.test.js` — **new**: insert + prune.

### Tick field sources (all already present in the fetched Jupiter `asset`)

| Column | Source | Serves |
|---|---|---|
| price, mcap, pnl_percent | computed in `refreshPosition()` | point 1 |
| high_water_mcap, low_water_mcap, trailing_armed | computed in `refreshPosition()` | point 1 |
| liquidity_usd | `asset.liquidity` | point 1 |
| holder_count | `asset.holderCount` | point 4 |
| holder_change_5m | `asset.stats5m.holderChange` | point 4 (churn) |
| buys_5m, sells_5m | `asset.stats5m.numBuys / numSells` | point 2 (velocity) |
| buy_vol_5m, sell_vol_5m | `asset.stats5m.buyVolume / sellVolume` | point 2 |
| price_change_5m | `asset.stats5m.priceChange` | point 2 |
| top_holders_pct | `asset.audit.topHoldersPercentage` | point 4 |
| bot_holders_pct | `asset.audit.botHoldersPercentage` | point 3 data (free) |
| bundler_holding_pct | `asset.audit.bundlerStats.holdingPct` | point 3 data (free) |

> Note vs spec: spec listed a single `vol_5m`; Jupiter exposes split `buyVolume`/`sellVolume`, so we store both. `bot_holders_pct`, `bundler_holding_pct`, and `holder_change_5m` are zero-cost additions that directly serve deferred points 3 and 4 — captured as data now even though no gate consumes them yet.

---

## Task 1: `position_ticks` table + `src/db/ticks.js`

**Files:**
- Modify: `src/db/connection.js` (inside `initDb()`, in the `db.exec(...)` schema block and the index list)
- Create: `src/db/ticks.js`
- Test: `tests/db/ticks.test.js`

- [ ] **Step 1: Add the table + index to the schema block**

In `src/db/connection.js`, inside the big `db.exec(\`...\`)` template in `initDb()`, add this table definition immediately after the `CREATE TABLE IF NOT EXISTS price_alerts (...)` block (before the `CREATE INDEX` lines):

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
      holder_change_5m REAL,
      buys_5m INTEGER,
      sells_5m INTEGER,
      buy_vol_5m REAL,
      sell_vol_5m REAL,
      price_change_5m REAL,
      top_holders_pct REAL,
      bot_holders_pct REAL,
      bundler_holding_pct REAL
    );
```

And add this line alongside the other `CREATE INDEX IF NOT EXISTS` statements in the same `db.exec`:

```sql
    CREATE INDEX IF NOT EXISTS idx_position_ticks_pos ON position_ticks(position_id, at_ms);
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/ticks.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, db } from '../../src/db/connection.js';
import { insertPositionTick, ticksForPosition, pruneTicks } from '../../src/db/ticks.js';

initDb();

function makeTick(overrides = {}) {
  return {
    position_id: 1, mint: 'MINT', at_ms: 1000, ms_since_open: 0,
    price: 0.001, mcap: 10000, pnl_percent: 0,
    high_water_mcap: 10000, low_water_mcap: 10000, trailing_armed: 0,
    liquidity_usd: 5000, holder_count: 100, holder_change_5m: 0,
    buys_5m: 10, sells_5m: 5, buy_vol_5m: 100, sell_vol_5m: 50,
    price_change_5m: 1.2, top_holders_pct: 20, bot_holders_pct: 30,
    bundler_holding_pct: 0.1,
    ...overrides,
  };
}

test('insertPositionTick stores and ticksForPosition reads back in order', () => {
  insertPositionTick(makeTick({ position_id: 1, at_ms: 2000 }));
  insertPositionTick(makeTick({ position_id: 1, at_ms: 1000 }));
  const ticks = ticksForPosition(1);
  assert.equal(ticks.length, 2);
  assert.equal(ticks[0].at_ms, 1000);
  assert.equal(ticks[1].at_ms, 2000);
  assert.equal(ticks[0].mcap, 10000);
});

test('pruneTicks removes ticks for positions closed before cutoff', () => {
  db.prepare(`INSERT INTO dry_run_positions
    (id, mint, status, opened_at_ms, closed_at_ms, size_sol, tp_percent, sl_percent,
     trailing_enabled, trailing_percent, snapshot_json)
    VALUES (99, 'OLD', 'closed', 1, 5000, 0.05, 50, -25, 1, 10, '{}')`).run();
  insertPositionTick(makeTick({ position_id: 99, at_ms: 100 }));
  const removed = pruneTicks(6000);
  assert.equal(removed, 1);
  assert.equal(ticksForPosition(99).length, 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/db/ticks.test.js`
Expected: FAIL — `Cannot find module '.../src/db/ticks.js'`.

- [ ] **Step 4: Create `src/db/ticks.js`**

```js
import { db } from './connection.js';

const insertStmt = () => db.prepare(`
  INSERT INTO position_ticks
    (position_id, mint, at_ms, ms_since_open, price, mcap, pnl_percent,
     high_water_mcap, low_water_mcap, trailing_armed, liquidity_usd, holder_count,
     holder_change_5m, buys_5m, sells_5m, buy_vol_5m, sell_vol_5m,
     price_change_5m, top_holders_pct, bot_holders_pct, bundler_holding_pct)
  VALUES
    (@position_id, @mint, @at_ms, @ms_since_open, @price, @mcap, @pnl_percent,
     @high_water_mcap, @low_water_mcap, @trailing_armed, @liquidity_usd, @holder_count,
     @holder_change_5m, @buys_5m, @sells_5m, @buy_vol_5m, @sell_vol_5m,
     @price_change_5m, @top_holders_pct, @bot_holders_pct, @bundler_holding_pct)
`);

export function insertPositionTick(tick) {
  insertStmt().run(tick);
}

export function ticksForPosition(positionId) {
  return db.prepare(
    'SELECT * FROM position_ticks WHERE position_id = ? ORDER BY at_ms ASC'
  ).all(positionId);
}

export function pruneTicks(olderThanMs) {
  return db.prepare(`
    DELETE FROM position_ticks WHERE position_id IN (
      SELECT id FROM dry_run_positions
      WHERE status = 'closed' AND closed_at_ms IS NOT NULL AND closed_at_ms < ?
    )
  `).run(olderThanMs).changes;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/db/ticks.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/db/connection.js src/db/ticks.js tests/db/ticks.test.js
git commit -m "feat(ticks): add position_ticks table and access module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `evaluateExit()` pure function

**Files:**
- Create: `src/execution/exitLogic.js`
- Test: `tests/execution/exitLogic.test.js`

This mirrors the current decision logic in `src/execution/positions.js:117-186` exactly (verify line-by-line against that block). SL/TP run off `pnlPercentOverride` when supplied (live Jupiter PnL); trailing and rug-guard always run off mcap drawdown.

- [ ] **Step 1: Write the failing test**

Create `tests/execution/exitLogic.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExit } from '../../src/execution/exitLogic.js';

const base = {
  entry_mcap: 10000, entry_price: 0.001,
  high_water_mcap: 10000, high_water_price: 0.001,
  low_water_mcap: 10000, low_water_price: 0.001,
  trailing_armed: 0, trailing_enabled: true, trailing_percent: 10,
  tp_percent: 250, sl_percent: -25, partial_tp_done: 0, opened_at_ms: 0,
};
const strat = {
  trailing_arm_at_percent: 15, rug_guard_drop_pct: 50,
  partial_tp: true, partial_tp_at_percent: 15, partial_tp_sell_percent: 50,
  max_hold_ms: 0,
};

test('no exit when flat', () => {
  const r = evaluateExit(base, { mcap: 10000, price: 0.001, at_ms: 1 }, strat);
  assert.equal(r.exitReason, null);
  assert.equal(r.trailingArmed, false);
});

test('SL fires at sl_percent', () => {
  const r = evaluateExit(base, { mcap: 7400, price: 0.00074, at_ms: 1 }, strat);
  assert.equal(r.exitReason, 'SL'); // -26% <= -25%
});

test('rug guard takes precedence and fires on deep drop from peak', () => {
  const pos = { ...base, high_water_mcap: 20000, trailing_armed: 1 };
  // mcap 9000 = -55% from peak 20000, also below SL vs entry
  const r = evaluateExit(pos, { mcap: 9000, price: 0.0009, at_ms: 1 }, strat);
  assert.equal(r.exitReason, 'RUG_GUARD');
});

test('trailing arms at threshold and fires on giveback', () => {
  const pos = { ...base, high_water_mcap: 12000 }; // peak +20% >= arm 15%
  const r = evaluateExit(pos, { mcap: 10700, price: 0.00107, at_ms: 1 }, strat);
  // -10.8% from peak 12000 <= -10% trail
  assert.equal(r.trailingArmed, true);
  assert.equal(r.exitReason, 'TRAILING_TP');
});

test('partial TP triggers without exiting', () => {
  const r = evaluateExit(base, { mcap: 11600, price: 0.00116, at_ms: 1 }, strat);
  assert.equal(r.partialTpTriggered, true); // +16% >= 15%
  assert.equal(r.exitReason, null);
});

test('max hold fires after elapsed', () => {
  const r = evaluateExit(base, { mcap: 10000, price: 0.001, at_ms: 100 },
    { ...strat, max_hold_ms: 50 });
  assert.equal(r.exitReason, 'MAX_HOLD');
});

test('TP only fires when trailing disabled', () => {
  const pos = { ...base, trailing_enabled: false };
  const r = evaluateExit(pos, { mcap: 35000, price: 0.0035, at_ms: 1 }, strat);
  assert.equal(r.exitReason, 'TP'); // +250%
});

test('pnlPercentOverride drives SL for live positions', () => {
  // mcap flat (no mcap-based SL) but override says -30%
  const r = evaluateExit(base,
    { mcap: 10000, price: 0.001, at_ms: 1, pnlPercentOverride: -30 }, strat);
  assert.equal(r.exitReason, 'SL');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/execution/exitLogic.test.js`
Expected: FAIL — `Cannot find module '.../src/execution/exitLogic.js'`.

- [ ] **Step 3: Create `src/execution/exitLogic.js`**

```js
// Pure exit-decision logic shared by the live position monitor (refreshPosition)
// and the backtester. No DB, no network, no side effects: given a position
// state, a tick, and a strategy config, it returns updated water marks and any
// exit decision. Mirrors the order in src/execution/positions.js.

export function evaluateExit(position, tick, strat = {}) {
  const entryMcap = Number(position.entry_mcap);
  const mcap = Number(tick.mcap);
  const price = Number(tick.price);

  const highWaterMcap = Math.max(Number(position.high_water_mcap || 0), mcap);
  const highWaterPrice = Math.max(Number(position.high_water_price || 0), price || 0);
  const prevLowMcap = Number(position.low_water_mcap ?? position.entry_mcap ?? mcap);
  const prevLowPrice = Number(position.low_water_price ?? position.entry_price ?? price ?? 0);
  const lowWaterMcap = Math.min(prevLowMcap, mcap);
  const lowWaterPrice = price > 0 && prevLowPrice > 0
    ? Math.min(prevLowPrice, price)
    : (price || prevLowPrice);

  const mcapPnlPercent = (mcap / entryMcap - 1) * 100;
  const pnlPercent = Number.isFinite(Number(tick.pnlPercentOverride))
    ? Number(tick.pnlPercentOverride)
    : mcapPnlPercent;
  const peakPnlPercent = (highWaterMcap / entryMcap - 1) * 100;

  const trailingEnabled = Boolean(position.trailing_enabled);
  const trailingArmThreshold = Number(strat.trailing_arm_at_percent ?? 25);
  const trailingArmed = Boolean(position.trailing_armed)
    || (trailingEnabled && peakPnlPercent >= trailingArmThreshold);
  const trailDrop = highWaterMcap > 0 ? (mcap / highWaterMcap - 1) * 100 : 0;

  const tpHit = pnlPercent >= Number(position.tp_percent);
  const slHit = pnlPercent <= Number(position.sl_percent);
  const trailingHit = trailingArmed && trailingEnabled
    && trailDrop <= -Math.abs(Number(position.trailing_percent));

  let exitReason = null;
  if (Number(strat.max_hold_ms) > 0
      && (Number(tick.at_ms) - Number(position.opened_at_ms)) >= Number(strat.max_hold_ms)) {
    exitReason = 'MAX_HOLD';
  }

  let partialTpTriggered = false;
  if (!exitReason && strat.partial_tp && !position.partial_tp_done
      && pnlPercent >= Number(strat.partial_tp_at_percent)) {
    partialTpTriggered = true;
  }

  const rugGuardThreshold = Number(strat.rug_guard_drop_pct ?? 0);
  if (!exitReason && rugGuardThreshold > 0 && highWaterMcap > 0
      && trailDrop <= -rugGuardThreshold) {
    exitReason = 'RUG_GUARD';
  }

  if (!exitReason) {
    if (slHit) exitReason = 'SL';
    else if (tpHit && !trailingEnabled) exitReason = 'TP';
    else if (trailingHit) exitReason = 'TRAILING_TP';
  }

  return {
    exitReason,
    trailingArmed,
    partialTpTriggered,
    highWaterMcap,
    highWaterPrice,
    lowWaterMcap,
    lowWaterPrice,
    pnlPercent,
    peakPnlPercent,
    trailDrop,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/execution/exitLogic.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/execution/exitLogic.js tests/execution/exitLogic.test.js
git commit -m "feat(exits): extract pure evaluateExit decision function

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Refactor `refreshPosition()` to use `evaluateExit()`

Behavior-preserving. Replaces the inline computation block; side effects (DB writes, partial sell, live sell, close) stay.

**Files:**
- Modify: `src/execution/positions.js`

- [ ] **Step 1: Add the import**

At the top of `src/execution/positions.js`, after the existing `import { openPositions } from '../db/positions.js';` line, add:

```js
import { evaluateExit } from './exitLogic.js';
```

- [ ] **Step 2: Replace the computation block**

In `refreshPosition()`, replace the block from the `const strat = strategyById(position.strategy_id);` line through the end of the "Standard exit checks" block (currently `src/execution/positions.js:117-186`, ending with the closing brace of the `if (!exitReason) { ... }` group) with:

```js
  const strat = strategyById(position.strategy_id);
  const jPnlPercent = (jupiterPnl && Number.isFinite(Number(jupiterPnl.totalPnlPercentageNative)))
    ? Number(jupiterPnl.totalPnlPercentageNative)
    : null;
  const ev = evaluateExit(
    position,
    { mcap, price, at_ms: now(), pnlPercentOverride: jPnlPercent },
    strat,
  );
  const highWaterMcap = ev.highWaterMcap;
  const highWaterPrice = ev.highWaterPrice;
  const lowWaterMcap = ev.lowWaterMcap;
  const lowWaterPrice = ev.lowWaterPrice;
  const trailingArmed = ev.trailingArmed;
  let pnlPercent = ev.pnlPercent;
  let pnlSol = Number(position.size_sol) * pnlPercent / 100;
  if (jupiterPnl && Number.isFinite(Number(jupiterPnl.totalPnlNative))) {
    pnlSol = Number(jupiterPnl.totalPnlNative);
  }
  let exitReason = ev.exitReason;
  let closed = false;

  // Partial TP: mark done + (live) sell a fraction, without exiting.
  if (ev.partialTpTriggered) {
    db.prepare('UPDATE dry_run_positions SET partial_tp_done = 1 WHERE id = ?').run(position.id);
    console.log(`[position] ${position.id} partial TP at ${pnlPercent.toFixed(1)}% (${strat.partial_tp_sell_percent}% sell)`);
    if (position.execution_mode === 'live' && position.token_amount_raw) {
      try {
        const sellAmount = Math.floor(Number(position.token_amount_raw) * (strat.partial_tp_sell_percent / 100));
        if (sellAmount > 0) {
          const sell = await executeLiveSell({ ...position, token_amount_raw: String(sellAmount) }, 'PARTIAL_TP');
          const remaining = Number(position.token_amount_raw) - sellAmount;
          db.prepare('UPDATE dry_run_positions SET token_amount_raw = ? WHERE id = ?').run(String(remaining), position.id);
          db.prepare(`
            INSERT INTO dry_run_trades (position_id, mint, side, at_ms, price, mcap, size_sol, token_amount_est, reason, payload_json)
            VALUES (?, ?, 'sell', ?, ?, ?, ?, ?, 'PARTIAL_TP', ?)
          `).run(position.id, position.mint, now(), price, mcap,
            position.size_sol * (strat.partial_tp_sell_percent / 100), sellAmount,
            json({ pnlPercent, sell, partialSellPercent: strat.partial_tp_sell_percent, remaining }));
          console.log(`[position] ${position.id} partial TP sold ${sellAmount} tokens, ${remaining} remaining`);
        }
      } catch (err) {
        console.log(`[position] ${position.id} partial sell failed: ${err.message}`);
      }
    }
  }

  // Live exits will override these with realized SOL values
  let finalPnlPercent = pnlPercent;
  let finalPnlSol = pnlSol;
```

> Notes for the implementer:
> - The old code declared `pnlPercent`/`pnlSol` with `let` earlier (lines 126-127) and the jupiterPnl override at 128-131; that logic is now folded into the block above — delete the originals so they are not declared twice.
> - The old `// Live exits will override these...` lines (188-190) are reproduced at the end of the block above; delete the originals to avoid duplicate `let finalPnlPercent`.
> - The `db.prepare('UPDATE ... high_water_mcap ...')` water-mark write (currently 192-198) stays unchanged and now consumes the `highWaterMcap`/`lowWaterMcap`/`trailingArmed` consts defined above.
> - Everything from the water-mark UPDATE onward (the `if (exitReason && autoExit && ... live)` / `else if (exitReason && autoExit)` close blocks and the final `return {...}`) stays unchanged.

- [ ] **Step 3: Syntax check**

Run: `node --check src/execution/positions.js`
Expected: no output (exit 0).

- [ ] **Step 4: Run the full suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — all existing pipeline/scoring tests plus the new exitLogic and ticks tests.

- [ ] **Step 5: Commit**

```bash
git add src/execution/positions.js
git commit -m "refactor(positions): use shared evaluateExit in refreshPosition

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Write a tick each monitor cycle

**Files:**
- Modify: `src/execution/positions.js`

- [ ] **Step 1: Add the import**

After the `import { evaluateExit } from './exitLogic.js';` line added in Task 3, add:

```js
import { insertPositionTick } from '../db/ticks.js';
```

- [ ] **Step 2: Insert the tick after the water-mark UPDATE**

In `refreshPosition()`, immediately after the `db.prepare(\`UPDATE dry_run_positions SET high_water_mcap = ? ...\`).run(...)` statement (the water-mark write) and before the `if (exitReason && autoExit && position.execution_mode === 'live')` block, add:

```js
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
  try {
    const s5 = asset?.stats5m || {};
    const au = asset?.audit || {};
    const tickMs = now();
    insertPositionTick({
      position_id: position.id,
      mint: position.mint,
      at_ms: tickMs,
      ms_since_open: tickMs - Number(position.opened_at_ms),
      price: num(price),
      mcap: num(mcap),
      pnl_percent: num(pnlPercent),
      high_water_mcap: num(highWaterMcap),
      low_water_mcap: num(lowWaterMcap),
      trailing_armed: trailingArmed ? 1 : 0,
      liquidity_usd: num(asset?.liquidity),
      holder_count: int(asset?.holderCount),
      holder_change_5m: num(s5.holderChange),
      buys_5m: int(s5.numBuys),
      sells_5m: int(s5.numSells),
      buy_vol_5m: num(s5.buyVolume),
      sell_vol_5m: num(s5.sellVolume),
      price_change_5m: num(s5.priceChange),
      top_holders_pct: num(au.topHoldersPercentage),
      bot_holders_pct: num(au.botHoldersPercentage),
      bundler_holding_pct: num(au.bundlerStats?.holdingPct),
    });
  } catch (err) {
    console.log(`[position] ${position.id} tick insert failed: ${err.message}`);
  }
```

> The tick write is wrapped in try/catch so a tick failure can never block or fail an exit. `price`, `mcap`, `pnlPercent`, `highWaterMcap`, `lowWaterMcap`, `trailingArmed` are all in scope from Task 3; `asset` is in scope from the top of `refreshPosition()`.

- [ ] **Step 3: Syntax check**

Run: `node --check src/execution/positions.js`
Expected: no output (exit 0).

- [ ] **Step 4: Smoke-test the insert path against an in-memory DB**

Create a throwaway check and run it, then delete it:

Run:
```bash
cat > /tmp/tick_smoke.mjs <<'EOF'
process.env.DB_PATH = ':memory:';
const { initDb, db } = await import('/opt/charon/src/db/connection.js');
const { insertPositionTick, ticksForPosition } = await import('/opt/charon/src/db/ticks.js');
initDb();
insertPositionTick({
  position_id: 1, mint: 'M', at_ms: 1, ms_since_open: 0, price: 0.001, mcap: 10000,
  pnl_percent: 0, high_water_mcap: 10000, low_water_mcap: 10000, trailing_armed: 0,
  liquidity_usd: 5000, holder_count: 100, holder_change_5m: -1, buys_5m: 10, sells_5m: 5,
  buy_vol_5m: 100, sell_vol_5m: 50, price_change_5m: 1.2, top_holders_pct: 20,
  bot_holders_pct: 30, bundler_holding_pct: 0.1,
});
console.log('rows:', ticksForPosition(1).length);
EOF
node /tmp/tick_smoke.mjs && rm /tmp/tick_smoke.mjs
```
Expected: `rows: 1`.

- [ ] **Step 5: Commit**

```bash
git add src/execution/positions.js
git commit -m "feat(ticks): record a position_tick each monitor cycle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `scripts/backtest.js` CLI backtester

**Files:**
- Create: `scripts/backtest.js`
- Test: `tests/execution/backtest.test.js`

Pure simulation functions are exported and unit-tested; the CLI wrapper is guarded so importing the module in a test does not run it.

- [ ] **Step 1: Write the failing test**

Create `tests/execution/backtest.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, summarize } from '../../scripts/backtest.js';

const position = {
  id: 1, size_sol: 0.05, entry_mcap: 10000, entry_price: 0.001,
  trailing_enabled: true, trailing_percent: 10, tp_percent: 250, sl_percent: -25,
  opened_at_ms: 0, pnl_sol: -0.024, exit_reason: 'RUG_GUARD',
};
const strat = {
  trailing_arm_at_percent: 15, rug_guard_drop_pct: 50,
  partial_tp: false, partial_tp_at_percent: 0, partial_tp_sell_percent: 0, max_hold_ms: 0,
};
// price path: flat, dips to -30% (would hit a -25% SL), then craters to -55%
const ticks = [
  { at_ms: 10, mcap: 10000, price: 0.001 },
  { at_ms: 20, mcap: 7000, price: 0.0007 },
  { at_ms: 30, mcap: 4500, price: 0.00045 },
];

test('tighter SL exits the loser earlier than rug guard', () => {
  const r = simulate(position, ticks, { ...strat, sl_percent: -25 });
  assert.equal(r.exitReason, 'SL');
  assert.ok(r.pnlSol > -0.02, `expected smaller loss, got ${r.pnlSol}`);
  // -30% of 0.05 = -0.015
  assert.ok(Math.abs(r.pnlSol - (-0.015)) < 1e-9);
});

test('summarize aggregates baseline vs simulated', () => {
  const sim = simulate(position, ticks, { ...strat, sl_percent: -25 });
  const s = summarize([{ position, sim }]);
  assert.equal(s.count, 1);
  assert.ok(Math.abs(s.baselineSol - (-0.024)) < 1e-9);
  assert.ok(Math.abs(s.simulatedSol - (-0.015)) < 1e-9);
  assert.equal(s.simExitReasons.SL, 1);
});
```

> The simulate override carries `sl_percent` in the strat; `simulate` merges strat fields over the position so the SL flag drives the exit. The position's own `sl_percent` is overridden by building the effective position from strat where provided (see implementation).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/execution/backtest.test.js`
Expected: FAIL — `Cannot find module '.../scripts/backtest.js'`.

- [ ] **Step 3: Create `scripts/backtest.js`**

```js
// Read-only exit-rule backtester. Replays recorded position_ticks through the
// same evaluateExit() the live monitor uses, under overridden strategy params.
// NEVER writes to the DB.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initDb, db } from '../src/db/connection.js';
import { strategyById } from '../src/db/settings.js';
import { ticksForPosition } from '../src/db/ticks.js';
import { evaluateExit } from '../src/execution/exitLogic.js';

// Strategy fields that the position row also carries; overrides flow into both
// the effective strat (for evaluateExit thresholds) and the effective position
// (for SL/TP/trailing comparisons inside evaluateExit).
const POSITION_FIELDS = ['tp_percent', 'sl_percent', 'trailing_percent', 'trailing_enabled'];

export function simulate(position, ticks, strat) {
  const pos = { ...position };
  for (const f of POSITION_FIELDS) {
    if (strat[f] !== undefined && strat[f] !== null) pos[f] = strat[f];
  }
  const state = {
    ...pos,
    high_water_mcap: pos.entry_mcap, high_water_price: pos.entry_price,
    low_water_mcap: pos.entry_mcap, low_water_price: pos.entry_price,
    trailing_armed: 0, partial_tp_done: 0,
  };
  const size = Number(position.size_sol);
  let realizedSol = 0;
  let remaining = 1;

  for (const t of ticks) {
    const ev = evaluateExit(state, { mcap: t.mcap, price: t.price, at_ms: t.at_ms }, strat);
    state.high_water_mcap = ev.highWaterMcap;
    state.high_water_price = ev.highWaterPrice;
    state.low_water_mcap = ev.lowWaterMcap;
    state.low_water_price = ev.lowWaterPrice;
    state.trailing_armed = ev.trailingArmed ? 1 : 0;

    if (ev.partialTpTriggered && !state.partial_tp_done) {
      state.partial_tp_done = 1;
      const sellFrac = remaining * (Number(strat.partial_tp_sell_percent) / 100);
      realizedSol += size * sellFrac * (ev.pnlPercent / 100);
      remaining -= sellFrac;
    }
    if (ev.exitReason) {
      realizedSol += size * remaining * (ev.pnlPercent / 100);
      return { exitReason: ev.exitReason, pnlSol: realizedSol, exitTickMs: t.at_ms };
    }
  }
  const last = ticks[ticks.length - 1];
  const lastPnl = last ? (last.mcap / Number(pos.entry_mcap) - 1) * 100 : 0;
  realizedSol += size * remaining * (lastPnl / 100);
  return { exitReason: 'NO_EXIT', pnlSol: realizedSol, exitTickMs: last?.at_ms };
}

export function summarize(rows) {
  const out = {
    count: rows.length, baselineSol: 0, simulatedSol: 0,
    baselineWins: 0, simWins: 0, simExitReasons: {},
  };
  for (const { position, sim } of rows) {
    out.baselineSol += Number(position.pnl_sol || 0);
    out.simulatedSol += sim.pnlSol;
    if (Number(position.pnl_sol || 0) > 0) out.baselineWins += 1;
    if (sim.pnlSol > 0) out.simWins += 1;
    out.simExitReasons[sim.exitReason] = (out.simExitReasons[sim.exitReason] || 0) + 1;
  }
  return out;
}

function parseWindowMs(s) {
  const m = String(s).match(/^(\d+)([mhd])$/);
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  return n * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

function parseArgs(argv) {
  const a = { strategy: null, window: '7d', overrides: {}, sweep: null };
  const flagMap = {
    '--sl': 'sl_percent', '--tp': 'tp_percent', '--trail': 'trailing_percent',
    '--arm': 'trailing_arm_at_percent', '--rug': 'rug_guard_drop_pct',
    '--partial-at': 'partial_tp_at_percent', '--partial-sell': 'partial_tp_sell_percent',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--strategy') a.strategy = argv[++i];
    else if (k === '--window') a.window = argv[++i];
    else if (k === '--sweep') a.sweep = argv[++i]; // e.g. sl=-15,-20,-25
    else if (flagMap[k]) a.overrides[flagMap[k]] = Number(argv[++i]);
  }
  return a;
}

function loadRows(strategyId, windowMs) {
  const since = Date.now() - windowMs;
  const positions = db.prepare(`
    SELECT * FROM dry_run_positions
    WHERE status = 'closed' AND closed_at_ms >= ?
      AND (? IS NULL OR strategy_id = ?)
    ORDER BY closed_at_ms ASC
  `).all(since, strategyId, strategyId);
  return positions
    .map((position) => ({ position, ticks: ticksForPosition(position.id) }))
    .filter((r) => r.ticks.length > 0);
}

function fmt(n) { return (n >= 0 ? '+' : '') + Number(n).toFixed(4); }

function runOnce(rows, baseStratId, overrides) {
  const out = rows.map(({ position, ticks }) => {
    const strat = { ...strategyById(position.strategy_id || baseStratId), ...overrides };
    return { position, sim: simulate(position, ticks, strat) };
  });
  return summarize(out);
}

function main() {
  initDb();
  const args = parseArgs(process.argv.slice(2));
  const rows = loadRows(args.strategy, parseWindowMs(args.window));
  if (rows.length === 0) {
    console.log('No closed positions with ticks in window. Ticks are recorded only for positions opened after the feature shipped.');
    return;
  }
  console.log(`Backtesting ${rows.length} closed positions (strategy=${args.strategy || 'all'}, window=${args.window}).`);
  console.log('NOTE: fidelity bound by tick cadence (~10s) and Jupiter latency; no slippage/fee model. Relative comparison only.\n');

  if (args.sweep) {
    const [field, listRaw] = args.sweep.split('=');
    const flagMap = { sl: 'sl_percent', tp: 'tp_percent', trail: 'trailing_percent', arm: 'trailing_arm_at_percent', rug: 'rug_guard_drop_pct' };
    const key = flagMap[field] || field;
    const baseline = summarize(rows.map(({ position }) => ({ position, sim: { pnlSol: Number(position.pnl_sol || 0), exitReason: position.exit_reason } })));
    console.log(`baseline           total=${fmt(baseline.baselineSol)} wins=${baseline.baselineWins}/${baseline.count}`);
    for (const v of listRaw.split(',')) {
      const s = runOnce(rows, args.strategy, { ...args.overrides, [key]: Number(v) });
      console.log(`${key}=${String(v).padEnd(8)} total=${fmt(s.simulatedSol)} wins=${s.simWins}/${s.count} exits=${JSON.stringify(s.simExitReasons)}`);
    }
    return;
  }

  const s = runOnce(rows, args.strategy, args.overrides);
  console.log(`baseline (actual)  total=${fmt(s.baselineSol)} wins=${s.baselineWins}/${s.count}`);
  console.log(`simulated          total=${fmt(s.simulatedSol)} wins=${s.simWins}/${s.count}`);
  console.log(`delta              ${fmt(s.simulatedSol - s.baselineSol)} SOL`);
  console.log(`sim exit reasons   ${JSON.stringify(s.simExitReasons)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/execution/backtest.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all suites.

- [ ] **Step 6: Commit**

```bash
git add scripts/backtest.js tests/execution/backtest.test.js
git commit -m "feat(backtest): read-only exit-rule backtester over position_ticks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Point 1 (time-series) → Task 1 (table) + Task 4 (write path). ✓
- Point 2 (early velocity) → buys/sells/vol/price_change_5m columns (Task 1/4); queryable from ticks. ✓
- Point 4 cheap part (holder churn) → holder_count, holder_change_5m, top_holders_pct columns. ✓
- Point 3 data (free) → bot_holders_pct, bundler_holding_pct columns (noted as data-only, no gate yet). ✓
- `evaluateExit` shared function → Task 2; consumed live in Task 3, in backtester in Task 5. ✓
- CLI backtester with sweep + baseline-vs-sim + read-only → Task 5. ✓
- Limitations stated in output → `main()` prints the forward-looking / fidelity / no-slippage note. ✓
- Prune helper → `pruneTicks` (Task 1). ✓
- Refactor verified behavior-preserving → Task 3 Step 4 (`npm test`). ✓

**Deferred (out of scope, per spec):** wiring a gate that consumes bundler/rug data (point 3 logic) and the saved-wallets/exposure fix (point 5). Data for point 3 is now captured; gate wiring is a follow-up.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `insertPositionTick`/`ticksForPosition`/`pruneTicks` names consistent across Tasks 1, 4, 5. `evaluateExit` return keys (`exitReason`, `trailingArmed`, `partialTpTriggered`, `highWaterMcap`, `highWaterPrice`, `lowWaterMcap`, `lowWaterPrice`, `pnlPercent`) consumed consistently in Tasks 3 and 5. `simulate`/`summarize` signatures match between test and implementation. ✓
