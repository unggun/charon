import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, summarize } from '../../scripts/backtest.js';

const position = {
  id: 1, size_sol: 0.05, entry_mcap: 10000, entry_price: 0.001,
  trailing_enabled: true, trailing_percent: 10, tp_percent: 250, sl_percent: -90,
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

test('partial TP realizes a fraction then the remainder exits', () => {
  const pos = {
    id: 2, size_sol: 0.05, entry_mcap: 10000, entry_price: 0.001,
    trailing_enabled: false, trailing_percent: 0, tp_percent: 250, sl_percent: -25,
    opened_at_ms: 0, pnl_sol: 0, exit_reason: 'SL',
  };
  const pstrat = {
    trailing_arm_at_percent: 999, rug_guard_drop_pct: 0,
    partial_tp: true, partial_tp_at_percent: 16, partial_tp_sell_percent: 50, max_hold_ms: 0,
  };
  // tick1: +16% -> partial sells 50% at +16%; tick2: -30% -> SL exits remaining 50%
  const pticks = [
    { at_ms: 10, mcap: 12000, price: 0.0012 },
    { at_ms: 20, mcap: 7000, price: 0.0007 },
  ];
  const r = simulate(pos, pticks, pstrat);
  assert.equal(r.exitReason, 'SL');
  // 0.05*0.5*0.20 + 0.05*0.5*(-0.30) = 0.005 - 0.0075 = -0.0025
  assert.ok(Math.abs(r.pnlSol - (-0.0025)) < 1e-9, `got ${r.pnlSol}`);
});

test('NO_EXIT marks to last tick when nothing triggers', () => {
  const pos = {
    id: 3, size_sol: 0.05, entry_mcap: 10000, entry_price: 0.001,
    trailing_enabled: false, trailing_percent: 0, tp_percent: 250, sl_percent: -90,
    opened_at_ms: 0, pnl_sol: 0, exit_reason: null,
  };
  const nstrat = { trailing_arm_at_percent: 999, rug_guard_drop_pct: 0, partial_tp: false, max_hold_ms: 0 };
  const nticks = [{ at_ms: 10, mcap: 10500, price: 0.00105 }, { at_ms: 20, mcap: 11000, price: 0.0011 }];
  const r = simulate(pos, nticks, nstrat);
  assert.equal(r.exitReason, 'NO_EXIT');
  // last tick +10% on full size: 0.05 * 0.10 = 0.005
  assert.ok(Math.abs(r.pnlSol - 0.005) < 1e-9, `got ${r.pnlSol}`);
});

test('empty ticks returns NO_EXIT with zero pnl', () => {
  const pos = { id: 4, size_sol: 0.05, entry_mcap: 10000, entry_price: 0.001,
    trailing_enabled: false, trailing_percent: 0, tp_percent: 250, sl_percent: -90, opened_at_ms: 0, pnl_sol: 0 };
  const r = simulate(pos, [], { trailing_arm_at_percent: 999, rug_guard_drop_pct: 0, partial_tp: false, max_hold_ms: 0 });
  assert.equal(r.exitReason, 'NO_EXIT');
  assert.equal(r.pnlSol, 0);
});
