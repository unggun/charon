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
