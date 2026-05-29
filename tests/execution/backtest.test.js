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
