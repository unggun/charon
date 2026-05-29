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
